//! Frame layout + paint (chat, chrome, overlays).

use super::input_paint::{
    center_in_width, input_height, input_view_start_with_offset,
    paint_input_lines_ink_offset, trim_to_width, INPUT_VIEWPORT_LINES,
};
use super::text_util::{center, trunc};
use super::App;
use crate::layout::{solve_shell, ShellMetrics, Slot};
use crate::messages::{self, render_messages, select_row};
use crate::mouse;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;
use std::time::Instant;
use unicode_width::UnicodeWidthStr;

/// Pad a styled line to `width` display columns so every cell is rewritten each frame.
/// 补空格只用 **bg（聊天底）**，不带随机 fg；也不把整行重写成 pad 色（否则 MD 半截色条）。
fn pad_line_to_width(line: Line<'static>, width: usize, pad_style: Style) -> Line<'static> {
    if width == 0 {
        return line;
    }
    // 右侧空白：仅 bg，fg 与 bg 相同 → 不可见字符不串色
    let fill = Style::default()
        .fg(pad_style.bg.unwrap_or(Color::Reset))
        .bg(pad_style.bg.unwrap_or(Color::Reset));
    let plain: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
    let w = UnicodeWidthStr::width(plain.as_str());
    if w > width {
        // 溢出：尽量保留 span 样式截断（避免整行变成 pad 色）
        let mut spans: Vec<Span<'static>> = Vec::new();
        let mut used = 0usize;
        for sp in line.spans {
            if used >= width {
                break;
            }
            let s = sp.content.as_ref();
            let sw = UnicodeWidthStr::width(s);
            if used + sw <= width {
                used += sw;
                spans.push(sp);
            } else {
                let rest = width - used;
                let t = trim_to_width(s, rest);
                if !t.is_empty() {
                    spans.push(Span::styled(t, sp.style));
                }
                used = width;
                break;
            }
        }
        let tw = spans
            .iter()
            .map(|s| UnicodeWidthStr::width(s.content.as_ref()))
            .sum::<usize>();
        if tw < width {
            spans.push(Span::styled(" ".repeat(width - tw), fill));
        }
        return Line::from(spans);
    }
    if w == width {
        return line;
    }
    let mut spans = line.spans;
    spans.push(Span::styled(" ".repeat(width - w), fill));
    Line::from(spans)
}

/// Chat right scrollbar width (cols). Wider = easier to grab with mouse.
pub(crate) const CHAT_SCROLLBAR_W: u16 = 2;

/// Geometry of the last painted chat scrollbar (for hit-test / drag).
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ChatScrollbarGeom {
    pub rect: Rect,
    pub thumb_top: u16,
    pub thumb_h: u16,
    pub travel: u16,
    pub max_scroll: usize,
    pub track_h: u16,
}

/// Right-edge vertical scrollbar for chat (track + thumb).
/// Returns geometry for mouse hit-testing (None if not painted).
fn paint_chat_scrollbar(
    f: &mut Frame,
    area: Rect,
    from_bottom: usize,
    max_scroll: usize,
    body_h: usize,
    total_lines: usize,
    track_fg: Color,
    thumb_fg: Color,
    bg: Color,
    bar_w: u16,
) -> Option<ChatScrollbarGeom> {
    if area.width == 0 || area.height == 0 || total_lines <= body_h || max_scroll == 0 {
        return None;
    }
    let bar_w = bar_w.max(1).min(area.width);
    let track_h = area.height as usize;
    let thumb_h = ((body_h * track_h) / total_lines.max(1))
        .max(2) // min height so the thick bar stays easy to grab
        .min(track_h);
    // from_bottom=0 → thumb at bottom; from_bottom=max → thumb at top
    let travel = track_h.saturating_sub(thumb_h);
    let thumb_top = if max_scroll == 0 {
        travel
    } else {
        let from_top = max_scroll.saturating_sub(from_bottom);
        ((from_top * travel) / max_scroll).min(travel)
    };
    let bar_x0 = area.x.saturating_add(area.width.saturating_sub(bar_w));
    for i in 0..track_h {
        let y = area.y.saturating_add(i as u16);
        let on = i >= thumb_top && i < thumb_top + thumb_h;
        // Solid blocks read thicker than half-block glyphs on most terminals
        let ch = if on { "█" } else { "░" };
        let fg = if on { thumb_fg } else { track_fg };
        for dx in 0..bar_w {
            f.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    ch,
                    Style::default().fg(fg).bg(bg),
                ))),
                Rect {
                    x: bar_x0.saturating_add(dx),
                    y,
                    width: 1,
                    height: 1,
                },
            );
        }
    }
    Some(ChatScrollbarGeom {
        rect: Rect {
            x: bar_x0,
            y: area.y,
            width: bar_w,
            height: area.height,
        },
        thumb_top: thumb_top as u16,
        thumb_h: thumb_h as u16,
        travel: travel as u16,
        max_scroll,
        track_h: track_h as u16,
    })
}

impl App {
    pub fn note_frame(&mut self) {
        let now = Instant::now();
        self.frame_times.push_back(now);
        while self.frame_times.len() > 30 {
            self.frame_times.pop_front();
        }
        if self.frame_times.len() >= 2 {
            if let Some(front) = self.frame_times.front() {
                let dt = now.duration_since(*front).as_secs_f32();
                if dt > 0.0 {
                    self.fps = (self.frame_times.len() as f32 - 1.0) / dt;
                }
            }
        }
        // 流式 / 空开屏：每帧推进 spinner 相位
        if self.streaming
            || self.messages.iter().any(|m| m.streaming)
            || self.messages.is_empty()
        {
            self.spinner_frame = self.spinner_frame.wrapping_add(1);
        }
    }

    pub fn draw(&mut self, f: &mut Frame) {
        let area = f.area();
        let th = self.theme.clone();
        self.screen_cols = area.width;
        self.screen_rows = area.height;

        // ── Shell metrics (Ink Layout.tsx heights) → integer flex tree ──
        self.purge_toast();
        let has_approval = self.terminal_approval.is_some();
        let has_toast = self.local_toast.is_some() || self.chrome.toast.is_some();
        let empty = self.messages.is_empty();
        // 空开屏（画廊）会把 scroll_from_bottom 设为 max 以贴顶 logo，
        // 但那不是「聊天上滚」—— 不显示「上一条 / 回到底部」。
        let show_back = !empty && self.scroll_from_bottom > 0;
        let show_jump = !empty && self.scroll_from_bottom > 2;
        let comp_items = self
            .completions
            .as_ref()
            .map(|c| c.items.len().min(5))
            .unwrap_or(0);
        let show_comp = comp_items > 0;
        let comp_h: u16 = if show_comp {
            (comp_items as u16) + 1
        } else {
            0
        };
        let has_goal = self
            .chrome
            .supervisor
            .as_ref()
            .map(|s| s.active)
            .unwrap_or(false);
        let goal_h: u16 = if has_goal {
            let plan_lines = self
                .chrome
                .supervisor
                .as_ref()
                .and_then(|s| s.plan.as_ref())
                .map(|p| p.lines().take(10).count())
                .unwrap_or(0);
            let actions = self
                .chrome
                .supervisor
                .as_ref()
                .map(|s| match s.state.as_str() {
                    "confirming_plan" => 2u16,
                    "confirming" => 1,
                    "started" if s.last_verdict.is_some() => 1,
                    _ => 0,
                })
                .unwrap_or(0);
            (2 + plan_lines as u16 + actions + 1).min(16).max(3)
        } else {
            0
        };
        let event_h: u16 = if !show_comp
            && self.chrome.event_block_expanded
            && self
                .chrome
                .supervisor
                .as_ref()
                .map(|s| s.active)
                .unwrap_or(false)
        {
            15
        } else if !show_comp {
            1
        } else {
            0
        };
        // Body cols for soft-wrap: full width minus prompt (and 1 col scrollbar when tall).
        let prompt_w = mouse::prompt_cols() as usize;
        let approx_inp_w = area.width.max(8) as usize;
        let input_body_w = approx_inp_w.saturating_sub(prompt_w).max(4);
        let input_h = input_height(&self.input, input_body_w) as u16;

        // Overlay preferred size (absolute layer after flex)
        let (overlay_w, overlay_h) = if let Some(o) = &self.overlay {
            let w = (area.width * 2 / 3).max(40).min(area.width.saturating_sub(4));
            let h = if o.lines.as_ref().map(|l| !l.is_empty()).unwrap_or(false) {
                (o.lines.as_ref().map(|l| l.len()).unwrap_or(0) as u16 + 4)
                    .min(area.height.saturating_sub(4))
            } else {
                (o.items.len() as u16 + 4)
                    .min(area.height.saturating_sub(4))
                    .max(8)
            };
            (w, h)
        } else {
            (0, 0)
        };

        let metrics = ShellMetrics {
            has_goal,
            goal_h,
            has_approval,
            has_toast,
            show_back,
            show_jump: show_jump && !self.full_editor,
            empty_hint: empty && !show_comp && !self.full_editor,
            show_comp,
            comp_h,
            event_h,
            input_h,
            show_info: !show_comp,
            nav_seg_count: {
                let n = self.theme.nav_segs_for_draw().len() as u16;
                if n == 0 {
                    ShellMetrics::nav_count()
                } else {
                    n
                }
            },
            overlay_w,
            overlay_h,
            full_editor: self.full_editor,
        };
        let solved = solve_shell(&metrics, area);

        // 禁止每帧全屏 Block 填充：会让 ratatui diff 几乎整屏脏写，滚动出现「卷帘」。
        // 各区域（chat_inner / footer / nav）已各自 pad 满宽；整屏清洗仅用 terminal.clear()。

        // full editor — layout tree: FullEditor + body (padding = border)
        if self.full_editor {
            self.overlay_rect = None;
            self.completion_rect = None;
            self.event_rect = None;
            self.goal_rect = None;
            self.nav_segs.clear();
            let outer = solved.get(Slot::FullEditor).unwrap_or(area);
            let inner = solved
                .get(Slot::FullEditorBody)
                .unwrap_or_else(|| Rect {
                    x: outer.x.saturating_add(1),
                    y: outer.y.saturating_add(1),
                    width: outer.width.saturating_sub(2),
                    height: outer.height.saturating_sub(2),
                });
            let block = Block::default()
                .borders(Borders::ALL)
                .title(" 全屏编辑 · Esc 返回 · Ctrl+S 发送 ")
                .border_style(Style::default().fg(th.accent));
            self.full_editor_rect = Some(inner);
            f.render_widget(block, outer);
            self.tick_caret_blink();
            let fe_caret = self.caret_blink_on && !self.sel.has_input_text_sel();
            let lines = super::input_paint::paint_full_editor_lines(
                &self.full_editor_text,
                self.full_editor_cursor,
                Color::White,
                th.panel_bg,
                fe_caret,
            );
            f.render_widget(
                Paragraph::new(lines).wrap(Wrap { trim: false }),
                inner,
            );
            let fe_text = self.full_editor_text.clone();
            self.sel.apply_overlay(
                f.buffer_mut(),
                inner,
                0,
                inner,
                &fe_text,
                inner.x,
                0,
            );
            return;
        }
        self.full_editor_rect = None;

        // chat body from layout slots（无外框；ChatInner ≈ Chat 全区域）
        let chat = solved.get(Slot::Chat).unwrap_or(area);
        self.chat_rect = chat;
        let chat_full = solved.get(Slot::ChatInner).unwrap_or(chat);
        // Reserve CHAT_SCROLLBAR_W cols for scrollbar when content can scroll
        // (sticky last-frame flag so width stays stable while scrolling).
        let show_sb = self.max_scroll_lines > 0 || self.scroll_from_bottom > 0;
        let sb_w: u16 = if show_sb && chat_full.width > 6 {
            CHAT_SCROLLBAR_W
        } else {
            0
        };
        self.chat_inner = if sb_w > 0 {
            Rect {
                x: chat_full.x,
                y: chat_full.y,
                width: chat_full.width.saturating_sub(sb_w),
                height: chat_full.height,
            }
        } else {
            chat_full
        };
        // jump_prev_y set when painting JumpPrev (only when show_jump)

        self.tool_hits.clear();
        self.msg_expand_hits.clear();
        self.thinking_hits.clear();
        self.system_event_hits.clear();
        self.tool_result_hits.clear();
        // wrap width MUST equal chat_inner.width (same grid mouse hits)
        let body_h = self.chat_inner.height.max(1) as usize;
        let mut lines =
            self.build_scroll_lines(self.chat_inner.width.max(1) as usize, body_h);
        // Grok follow pad: empty rows under content so last user message can sit at
        // the top of the viewport (from_bottom=0). Pad shrinks as AI tail grows.
        // Empty gallery splash: no pad (would scroll logo off-screen).
        let tail_pad = if self.messages.is_empty() {
            0
        } else {
            // Lines from last user-head → end (before pad)
            let mut last_user: Option<usize> = None;
            for (i, line) in lines.iter().enumerate() {
                let plain: String =
                    line.spans.iter().map(|s| s.content.as_ref()).collect();
                if Self::looks_user_head_line(&plain) {
                    last_user = Some(i);
                }
            }
            let tail_lines = match last_user {
                Some(i) => lines.len().saturating_sub(i),
                None => {
                    // structured fallback: last human user message share of total
                    // (string probe miss → treat as unknown tail → generous when boost)
                    0
                }
            };
            self.follow_tail_pad_lines(body_h, tail_lines)
        };
        if tail_pad > 0 {
            for _ in 0..tail_pad {
                lines.push(Line::from(""));
            }
        }
        // plain text parallel for selection (pads are empty)
        self.scroll_plain = lines
            .iter()
            .map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect::<String>())
            .collect();
        let max_scroll = lines.len().saturating_sub(body_h.max(1));
        // ── Scroll follow (Ink autoFollow / pin-content) ────────────────────
        // auto_follow / from_bottom==0 → pin to latest (stream grows underfoot).
        // else → pin absolute content: from_bottom += Δmax so stream growth at
        // the tail does not drag the viewport toward latest.
        let prev_max = self.max_scroll_lines;
        if self.messages.is_empty() {
            // Empty splash: top-align (logo 贴顶)
            self.scroll_from_bottom = max_scroll as u16;
            self.auto_follow = false;
        } else if self.auto_follow || self.scroll_from_bottom == 0 {
            self.scroll_from_bottom = 0;
            self.auto_follow = true;
        } else {
            let next = Self::pin_scroll_on_max_change(
                self.scroll_from_bottom as usize,
                prev_max,
                max_scroll,
                false,
            );
            self.scroll_from_bottom = next as u16;
        }
        self.max_scroll_lines = max_scroll;
        let from_bottom = (self.scroll_from_bottom as usize).min(max_scroll);
        let end = lines.len().saturating_sub(from_bottom);
        let start = end.saturating_sub(body_h.max(1));
        self.visible_start = start;
        self.sel.tick_phase();

        // Build visible lines (pre-wrapped; must paint ONLY into chat_inner).
        // Critical: never Paragraph+Block on full `chat` — that overwrites JumpPrev
        // and misaligns rows vs mouse (chat_inner.y).
        self.chat_line_cache.clear();
        let x0 = self.chat_inner.x;
        let content_top = start as i64;
        let inner_w = self.chat_inner.width as usize;
        let pad_style = Style::default().fg(th.fg).bg(th.bg);
        let mut visible: Vec<Line> = Vec::new();
        for (i, line) in lines[start..end].iter().enumerate() {
            let screen_y = self.chat_inner.y.saturating_add(i as u16);
            let mut plain: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
            plain = trim_to_width(&plain, inner_w);
            self.chat_line_cache
                .push((screen_y, plain.clone(), x0));
            self.sel
                .put_line_cache(content_top + i as i64, plain.clone());

            let logical = start + i;
            let hid = self.hover_id.as_ref();
            // 收纳态「展开」芯片：只亮这一行的折叠文案，不整行铺 panel 黄底
            let expand_chip = hid
                .map(|h| {
                    self.msg_expand_hits.iter().any(|e| {
                        e.hover_paint
                            && e.line_idx == logical
                            && h == &format!("expand:{}", e.message_id)
                    })
                })
                .unwrap_or(false);
            // 工具头 / think / 系统事件：仍可整行轻提示（非消息全文）
            let other_hot = hid
                .map(|h| {
                    self.tool_hits
                        .iter()
                        .any(|t| t.line_idx == logical && h == &format!("tool:{}", t.tool_id))
                        || self.thinking_hits.iter().any(|t| {
                            t.line_idx == logical && h == &format!("think:{}", t.thinking_id)
                        })
                        || self.system_event_hits.iter().any(|s| {
                            s.line_idx == logical && h == &format!("sys:{}", s.event_id)
                        })
                })
                .unwrap_or(false);
            let row = if expand_chip {
                // 浅黄芯片：仅文案宽；右侧空白保持聊天底色
                let chip = plain.trim_end();
                let chip_style = Style::default()
                    .fg(Color::Black)
                    .bg(th.warn)
                    .add_modifier(Modifier::BOLD);
                if chip.is_empty() {
                    line.clone()
                } else {
                    Line::from(Span::styled(chip.to_string(), chip_style))
                }
            } else if other_hot {
                Line::from(Span::styled(
                    plain,
                    Style::default().fg(th.fg).bg(th.panel_bg),
                ))
            } else {
                line.clone()
            };
            // Pad to full width so every cell is rewritten (kills black-bar ghosting
            // from half-updated CJK rows after send/stream reflow).
            visible.push(pad_line_to_width(row, inner_w, pad_style));
        }
        // Fill viewport with full-width blank rows (same bg) — never leave stale cells
        let blank = pad_line_to_width(Line::from(""), inner_w, pad_style);
        while visible.len() < body_h {
            visible.push(blank.clone());
        }

        // Wipe chat_inner then paint body（无 ┌ maou ── 外框）
        f.render_widget(
            Block::default().style(Style::default().bg(th.bg).fg(th.fg)),
            self.chat_inner,
        );
        f.render_widget(Paragraph::new(visible), self.chat_inner);
        // Right scrollbar (when content overflows viewport)
        self.chat_sb_geom = None;
        if max_scroll > 0 && chat_full.width > self.chat_inner.width {
            let bar_w = chat_full.width.saturating_sub(self.chat_inner.width);
            self.chat_sb_geom = paint_chat_scrollbar(
                f,
                chat_full,
                from_bottom,
                max_scroll,
                body_h,
                lines.len(),
                th.dim,
                th.accent,
                th.bg,
                bar_w.max(1),
            );
        }
        // Jump bar only when show_jump（上滚）；贴底时不占顶行
        self.jump_prev_y = None;
        if show_jump {
            if let Some(jr) = solved.get(Slot::JumpPrev) {
                self.jump_prev_y = Some(jr.y);
                let preview = self.prev_user_jump_label(jr.width as usize);
                let line = pad_line_to_width(
                    Line::from(Span::styled(
                        trunc(&preview, jr.width as usize),
                        Style::default()
                            .fg(th.user)
                            .bg(th.user_bg)
                            .add_modifier(Modifier::BOLD),
                    )),
                    jr.width as usize,
                    Style::default().bg(th.user_bg),
                );
                f.render_widget(
                    Paragraph::new(line).style(Style::default().bg(th.user_bg)),
                    jr,
                );
            }
        }

        // PerfHud (top-right of chat) — solid panel bg wipe + full-width pad (no ghost cells)
        if self.chrome.perf_hud && !self.chrome.lite {
            let mut lines: Vec<String> = if !self.chrome.perf_lines.is_empty() {
                self.chrome.perf_lines.clone()
            } else {
                // fallback stub
                vec![format!(
                    " {:.0}fps · {} msgs · {} ",
                    self.fps,
                    self.messages.len(),
                    if self.streaming { "RUN" } else { "IDLE" }
                )]
            };
            // Prefix local paint fps when Node window fps is cold (ratatui path)
            if !lines.is_empty() && self.fps > 0.5 {
                let l0 = &lines[0];
                if !l0.contains("rt") {
                    lines[0] = format!(" rt{:.0} {l0}", self.fps);
                }
            }
            let heat = self.chrome.perf_heat.as_deref().unwrap_or("ok");
            let fg = match heat {
                "hot" => th.err,
                "warm" => th.warn,
                _ => th.accent2,
            };
            let n = lines.len() as u16;
            let max_w = lines
                .iter()
                .map(|l| UnicodeWidthStr::width(l.as_str()))
                .max()
                .unwrap_or(0) as u16;
            // Cap width so long/garbled lines never spill over the gallery logo
            let max_w = max_w.min(chat.width.saturating_sub(4)).max(8);
            if chat.width > max_w + 2 && chat.height > n {
                let hr = Rect {
                    x: chat.x.saturating_add(chat.width.saturating_sub(max_w + 1)),
                    y: chat.y,
                    width: max_w.min(chat.width),
                    height: n.min(chat.height),
                };
                // Wipe hud rect first (panel bg) — kills leftover CJK half-cells
                f.render_widget(
                    Block::default().style(Style::default().bg(th.panel_bg).fg(th.panel_bg)),
                    hr,
                );
                let pad_style = Style::default().fg(th.dim).bg(th.panel_bg);
                let para_lines: Vec<Line> = lines
                    .iter()
                    .enumerate()
                    .map(|(i, l)| {
                        let color = if i == 0 {
                            fg
                        } else if i == 4 {
                            match heat {
                                "hot" => th.err,
                                "warm" => th.warn,
                                _ => th.dim,
                            }
                        } else {
                            th.dim
                        };
                        let plain = trunc(l, max_w as usize);
                        let row = Line::from(Span::styled(
                            plain,
                            Style::default()
                                .fg(color)
                                .bg(th.panel_bg)
                                .add_modifier(if i == 0 {
                                    Modifier::BOLD
                                } else {
                                    Modifier::empty()
                                }),
                        ));
                        pad_line_to_width(row, max_w as usize, pad_style)
                    })
                    .collect();
                f.render_widget(Paragraph::new(para_lines), hr);
            }
        }

        // Goal / supervisor panel
        self.goal_rect = None;
        if has_goal {
            let r = match solved.get(Slot::Goal) {
                Some(r) => r,
                None => Rect::default(),
            };
            self.goal_rect = Some(r);
            if let Some(sup) = &self.chrome.supervisor {
                // Ink GoalPanel stateLabel
                let state_label = match sup.state.as_str() {
                    "planning" => "规划中".to_string(),
                    "confirming_plan" => "待确认计划".to_string(),
                    "started" => format!("执行中 · {} 轮", sup.verify_rounds.unwrap_or(0)),
                    "confirming" => "待最终验收".to_string(),
                    "ended" => "已结束".to_string(),
                    other => other.to_string(),
                };
                let border_fg = if matches!(
                    sup.state.as_str(),
                    "confirming_plan" | "confirming"
                ) {
                    th.warn
                } else {
                    th.accent
                };
                let plan_chars = sup.plan.as_ref().map(|p| p.chars().count()).unwrap_or(0);
                let mut body: Vec<Line> = vec![Line::from(vec![
                    Span::styled(
                        format!(" 🎯 监督模式 · {state_label} "),
                        Style::default()
                            .fg(border_fg)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        if plan_chars > 0 {
                            format!("{plan_chars} 字计划 ▼")
                        } else {
                            String::new()
                        },
                        Style::default().fg(th.dim),
                    ),
                ])];
                if let Some(plan) = &sup.plan {
                    let total_lines = plan.lines().count();
                    for pl in plan.lines().take(10) {
                        body.push(Line::from(Span::styled(
                            format!("  {pl}"),
                            Style::default().fg(th.fg),
                        )));
                    }
                    if total_lines > 10 {
                        body.push(Line::from(Span::styled(
                            format!("  …（共 {total_lines} 行，展开 EventBlock 查看完整监督输出）"),
                            Style::default().fg(th.dim),
                        )));
                    }
                }
                // Ink GoalButton rows (click → goal_action)
                match sup.state.as_str() {
                    "confirming_plan" => {
                        body.push(Line::from(Span::styled(
                            "  ✓ 确认计划，开始监督 ".to_string(),
                            Style::default()
                                .fg(Color::Black)
                                .bg(th.accent)
                                .add_modifier(Modifier::BOLD),
                        )));
                        body.push(Line::from(Span::styled(
                            "  ✎ 修改（在输入框发改动说明） ".to_string(),
                            Style::default().fg(th.fg).bg(th.muted),
                        )));
                    }
                    "confirming" => {
                        body.push(Line::from(Span::styled(
                            "  ✓ 通过验收，结束监督 ".to_string(),
                            Style::default()
                                .fg(Color::Black)
                                .bg(th.ok)
                                .add_modifier(Modifier::BOLD),
                        )));
                    }
                    _ => {}
                }
                if let Some(v) = &sup.last_verdict {
                    let pass = v.eq_ignore_ascii_case("pass") || v == "合格";
                    let (label, fg) = if pass {
                        ("合格", th.ok)
                    } else if v.eq_ignore_ascii_case("fail")
                        || v == "不合格"
                        || v.eq_ignore_ascii_case("reject")
                    {
                        ("不合格", th.err)
                    } else {
                        (v.as_str(), th.muted)
                    };
                    body.push(Line::from(Span::styled(
                        format!("  上轮验收：{label}"),
                        Style::default().fg(fg),
                    )));
                }
                f.render_widget(
                    Paragraph::new(body).block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(border_fg)),
                    ),
                    r,
                );
            }
        }

        self.approval_rect = None;
        self.approval_chips.clear();
        // 不用 unwrap：has_approval 与 Option 可能瞬时不一致，panic 会整 TUI 闪退
        if let Some(a) = self.terminal_approval.as_ref() {
            let r = match solved.get(Slot::Approval) {
                Some(r) => r,
                None => Rect::default(),
            };
            self.approval_rect = Some(r);
            // 风险色：high=红底，low=黄底；展示人话简介 + 命令
            let risk = a
                .risk
                .as_deref()
                .unwrap_or("low")
                .to_ascii_lowercase();
            let high = risk == "high" || risk == "dangerous" || risk == "fatal";
            let bar_bg = if high { th.err } else { th.warn };
            let title = if high { "高风险审批" } else { "命令审批" };
            let label = a
                .label
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| if high { "高风险".into() } else { "需确认".into() });
            let summary = a
                .summary
                .clone()
                .or_else(|| a.hint.clone())
                .unwrap_or_else(|| {
                    if high {
                        "此命令风险较高，请确认后再授权。".into()
                    } else {
                        "AI 请求在终端执行该命令。".into()
                    }
                });
            let cmd = trunc(&a.command, (r.width as usize).saturating_sub(4).max(8));
            let sum = trunc(&summary, (r.width as usize).saturating_sub(4).max(8));
            // 可点按键：白底/高亮底 + 键位，与条底色区分
            let defs = [
                ("Y", "一次", "y", th.ok),
                ("A", "总是", "a", th.accent),
                ("N", "拒绝", "n", th.warn),
                ("B", "拉黑", "b", th.err),
            ];
            let title_s = format!(" {title} · {label}  ");
            let mut x_cursor = r.x.saturating_add(UnicodeWidthStr::width(title_s.as_str()) as u16);
            let mut spans: Vec<Span<'static>> = vec![Span::styled(
                title_s,
                Style::default()
                    .fg(Color::Black)
                    .bg(bar_bg)
                    .add_modifier(Modifier::BOLD),
            )];
            for (key, lab, choice, base_bg) in defs {
                let hot = self
                    .approval_hover
                    .as_deref()
                    .map(|h| h == choice)
                    .unwrap_or(false);
                let chip_txt = format!(" [{key}] {lab} ");
                let w = UnicodeWidthStr::width(chip_txt.as_str()) as u16;
                let x0 = x_cursor;
                let x1 = x_cursor.saturating_add(w);
                self.approval_chips.push((x0, x1, choice.into()));
                x_cursor = x1.saturating_add(1); // gap
                let (fg, bg) = if hot {
                    (Color::Black, th.accent)
                } else {
                    (Color::Black, base_bg)
                };
                spans.push(Span::styled(
                    chip_txt,
                    Style::default()
                        .fg(fg)
                        .bg(bg)
                        .add_modifier(Modifier::BOLD),
                ));
                spans.push(Span::styled(" ", Style::default().bg(bar_bg)));
            }
            spans.push(Span::styled(
                "  Y/A/N/B 键盘 ",
                Style::default().fg(Color::Black).bg(bar_bg),
            ));
            let line0 = Line::from(spans);
            let line1 = Line::from(Span::styled(
                format!(" AI说明: {sum}"),
                Style::default().fg(Color::Black).bg(bar_bg),
            ));
            let line2 = Line::from(Span::styled(
                format!(" $ {cmd}"),
                Style::default()
                    .fg(Color::Black)
                    .bg(bar_bg)
                    .add_modifier(Modifier::BOLD),
            ));
            f.render_widget(
                Paragraph::new(vec![line0, line1, line2]).style(Style::default().bg(bar_bg)),
                r,
            );
        }

        // Ink BackToBottomSlot: always consume 1 row
        self.back_to_bottom_y = None;
        if let Some(r) = solved.get(Slot::BackToBottom) {
            if show_back {
                self.back_to_bottom_y = Some(r.y);
                let label = " ↓ 点击回到最底部 ";
                let pad = (r.width as usize).saturating_sub(UnicodeWidthStr::width(label));
                let left = pad / 2;
                let line = format!(
                    "{}{}{}",
                    " ".repeat(left),
                    label,
                    " ".repeat(pad - left)
                );
                f.render_widget(
                    Paragraph::new(Line::from(Span::styled(
                        line,
                        Style::default()
                            .fg(th.user)
                            .bg(th.user_bg)
                            .add_modifier(Modifier::BOLD),
                    ))),
                    r,
                );
            } else {
                f.render_widget(Paragraph::new(" "), r);
            }
        }

        if has_toast {
            let r = match solved.get(Slot::Toast) {
                Some(r) => r,
                None => Rect::default(),
            };
            // 对齐 Ink ToastBar：整行色底居中 + ✓/⚠/✕ 前缀
            let (text, kind) = if let Some(lt) = &self.local_toast {
                (lt.text.clone(), lt.kind.clone())
            } else if let Some(t) = &self.chrome.toast {
                (t.text.clone(), t.kind.clone())
            } else {
                (String::new(), "info".into())
            };
            let (bg, fg, prefix) = match kind.as_str() {
                "err" => (th.err, Color::Black, "✕ "),
                "warn" => (th.warn, Color::Black, "⚠ "),
                "ok" => (th.accent, Color::Black, "✓ "),
                _ => (th.info, Color::White, "· "),
            };
            // 先整格铺底，再写居中字（避免右侧空 cell 无 bg）
            f.render_widget(
                Block::default().style(Style::default().bg(bg).fg(bg)),
                r,
            );
            let raw = format!("{prefix}{text}");
            let line = center(&raw, r.width as usize);
            let pad_style = Style::default().fg(fg).bg(bg).add_modifier(Modifier::BOLD);
            let row = pad_line_to_width(
                Line::from(Span::styled(line, pad_style)),
                r.width as usize,
                Style::default().bg(bg).fg(bg),
            );
            f.render_widget(Paragraph::new(row), r);
        }

        if empty {
            if let Some(r) = solved.get(Slot::EmptyHint) {
                let hint = self
                    .chrome
                    .empty_hint
                    .clone()
                    .unwrap_or_else(|| "输入消息开始对话 · Ctrl+K 命令 · Ctrl+C 退出".into());
                // Ink EmptySessionHint: blank row + centered line
                let lines = vec![
                    Line::from(""),
                    Line::from(Span::styled(
                        center(&hint, r.width as usize),
                        Style::default().fg(th.dim),
                    )),
                ];
                f.render_widget(Paragraph::new(lines), r);
            }
        }

        // Completion menu ABOVE input (Ink InputBar); hide Event when open
        self.completion_rect = None;
        // 与 show_comp 解耦：completions 可能在布局后清空，禁止 unwrap
        if let Some(c) = self.completions.as_ref().filter(|c| !c.items.is_empty()) {
            let r = match solved.get(Slot::Completion) {
                Some(r) => r,
                None => Rect::default(),
            };
            self.completion_rect = Some(r);
            // Ink: computer-blue panel, ▸ selected, accent yellow selected row
            let comp_bg = th.info; // #2121FF
            let mut lines: Vec<Line> = Vec::new();
            for (i, it) in c.items.iter().take(5).enumerate() {
                let desc = it.description.clone().unwrap_or_default();
                let is_sel = i == c.sel;
                let (row_bg, row_fg, desc_fg, ptr) = if is_sel {
                    (th.accent, Color::Black, th.panel_bg, "▸ ")
                } else {
                    (comp_bg, Color::White, th.completion_desc, "  ")
                };
                let mut spans = vec![Span::styled(
                    format!("{ptr}{} ", it.label),
                    Style::default()
                        .fg(row_fg)
                        .bg(row_bg)
                        .add_modifier(if is_sel {
                            Modifier::BOLD
                        } else {
                            Modifier::empty()
                        }),
                )];
                if !desc.is_empty() {
                    spans.push(Span::styled(
                        desc,
                        Style::default().fg(desc_fg).bg(row_bg),
                    ));
                }
                lines.push(Line::from(spans));
            }
            lines.push(Line::from(Span::styled(
                " ↑↓ 选择 · Tab/Enter 确认 · Esc 关闭".to_string(),
                Style::default().fg(th.completion_hint).bg(comp_bg),
            )));
            f.render_widget(
                Paragraph::new(lines).style(Style::default().bg(comp_bg)),
                r,
            );
        }

        // EventBlock — Ink shortStatus OR expanded supervisor log (12 lines)
        self.event_rect = None;
        if event_h > 0 {
            let ev = match solved.get(Slot::Event) {
                Some(r) => r,
                None => Rect::default(),
            };
            self.event_rect = Some(ev);
            let sup_active = self
                .chrome
                .supervisor
                .as_ref()
                .map(|s| s.active)
                .unwrap_or(false);
            // 展开监督面板：仅 expanded && supervisor active；否则画短状态条
            // 避免 unwrap：用 clone 状态字段后离开 borrow
            let paint_expanded = self.chrome.event_block_expanded
                && self
                    .chrome
                    .supervisor
                    .as_ref()
                    .map(|s| s.active)
                    .unwrap_or(false);
            if paint_expanded {
                if let Some(sup) = self.chrome.supervisor.clone() {
                let state_label = match sup.state.as_str() {
                    "planning" => "规划中",
                    "confirming_plan" => "待确认计划",
                    "started" => "执行中",
                    "confirming" => "待最终验收",
                    "ended" => "已结束",
                    other => other,
                };
                let border = if matches!(
                    sup.state.as_str(),
                    "confirming_plan" | "confirming"
                ) {
                    th.warn
                } else {
                    th.accent
                };
                let mut body: Vec<Line> = Vec::new();
                let mut head_spans = vec![Span::styled(
                    format!(" 🎯 SUP · {state_label} "),
                    Style::default()
                        .fg(border)
                        .add_modifier(Modifier::BOLD),
                )];
                head_spans.push(Span::styled(
                    "▼ fold ".to_string(),
                    Style::default().fg(th.dim),
                ));
                if let Some(v) = &sup.last_verdict {
                    let pass = v.eq_ignore_ascii_case("pass") || v == "合格";
                    head_spans.push(Span::styled(
                        if pass { "PASS" } else { "FAIL" }.to_string(),
                        Style::default().fg(if pass { th.ok } else { th.err }),
                    ));
                }
                body.push(Line::from(head_spans));
                // Flatten supervisor messages into lines, then window 12
                let mut all_lines: Vec<String> = Vec::new();
                if self.chrome.supervisor_messages.is_empty() {
                    all_lines.push("(supervisor output)".into());
                } else {
                    for msg in &self.chrome.supervisor_messages {
                        for l in msg.lines() {
                            all_lines.push(l.to_string());
                        }
                    }
                }
                let view_h = 12usize;
                let max_scroll = all_lines.len().saturating_sub(view_h);
                if self.event_expand_scroll as usize > max_scroll {
                    self.event_expand_scroll = max_scroll as u16;
                }
                let start = self.event_expand_scroll as usize;
                let end = (start + view_h).min(all_lines.len());
                for line in &all_lines[start..end] {
                    body.push(Line::from(Span::styled(
                        format!(" {line}"),
                        Style::default().fg(th.fg),
                    )));
                }
                while body.len() < 13 {
                    body.push(Line::from(Span::raw(" ")));
                }
                f.render_widget(
                    Paragraph::new(body).block(
                        Block::default()
                            .borders(Borders::ALL)
                            .border_style(Style::default().fg(border)),
                    ),
                    ev,
                );
                } // if let Some(sup)
            } else {
                let mode = self.chrome.event_mode.clone().unwrap_or_else(|| {
                    if self.streaming {
                        "generating".into()
                    } else {
                        "idle".into()
                    }
                });
                let up = self.chrome.up_tokens.unwrap_or(0);
                let down = self.chrome.down_tokens.unwrap_or(0);
                let appr = self
                    .chrome
                    .approval_mode
                    .clone()
                    .unwrap_or_else(|| "normal".into());
                let pending = self.chrome.pending_count.unwrap_or(0);
                let detail = self.chrome.detail.clone().unwrap_or_default();
                // Supervisor collapsed chip (Ink EventBlockCollapsed) when active
                let ev_line = if sup_active {
                    if let Some(sup) = &self.chrome.supervisor {
                        let label = match sup.state.as_str() {
                            "planning" => "规划中",
                            "confirming_plan" => "待确认计划",
                            "started" => "执行中",
                            "confirming" => "待最终验收",
                            other => other,
                        };
                        Line::from(Span::styled(
                            format!(
                                " 🎯 SUP · {label}  ▶ expand · 轮次{} ",
                                sup.verify_rounds.unwrap_or(0)
                            ),
                            Style::default()
                                .fg(Color::Black)
                                .bg(th.warn)
                                .add_modifier(Modifier::BOLD),
                        ))
                    } else {
                        messages::render_event_block_framed(
                            ev.width,
                            &th,
                            &mode,
                            self.chrome.aborting,
                            &appr,
                            up,
                            down,
                            &detail,
                            pending,
                            self.spinner_frame,
                        )
                    }
                } else {
                    messages::render_event_block_framed(
                        ev.width,
                        &th,
                        &mode,
                        self.chrome.aborting,
                        &appr,
                        up,
                        down,
                        &detail,
                        pending,
                        self.spinner_frame,
                    )
                };
                f.render_widget(
                    Paragraph::new(ev_line).style(Style::default().bg(th.footer_bg)),
                    ev,
                );
            }
        }

        // Input — footerBg + `❯ ` + fieldBg body; reverse-video caret (not ▌)
        let inp = solved.get(Slot::Input).unwrap_or(Rect::default());
        self.input_rect = inp;
        let ph = self
            .chrome
            .input_placeholder
            .clone()
            .unwrap_or_else(|| "输入文字…（/ 命令 · Ctrl+E 全屏）".into());
        let field_bg = th.input_field_bg;
        // Ink hasTextSel ⇒ focus off insert caret (mutual exclusion with selection box)
        self.tick_caret_blink();
        let show_caret = self.should_show_insert_caret();
        let body_w = self.input_body_width();
        let n_lines = self.input_display_line_count();
        // Clamp manual offset (display rows after soft-wrap)
        if let Some(off) = self.input_view_offset {
            let max_off = n_lines.saturating_sub(INPUT_VIEWPORT_LINES);
            if off > max_off {
                self.input_view_offset = if max_off == 0 { None } else { Some(max_off) };
            }
        }
        let input_lines = if self.input.is_empty() {
            // 光标格始终占 1 列：闪烁时反色，熄灭时同底，避免 placeholder 左右抖
            let mut spans = vec![Span::styled(
                mouse::PROMPT_STR.to_string(),
                Style::default()
                    .fg(Color::Black)
                    .bg(th.footer_bg)
                    .add_modifier(Modifier::BOLD),
            )];
            if show_caret {
                spans.push(Span::styled(
                    " ".to_string(),
                    Style::default()
                        .fg(field_bg)
                        .bg(Color::Black)
                        .add_modifier(Modifier::BOLD),
                ));
            } else {
                spans.push(Span::styled(
                    " ".to_string(),
                    Style::default()
                        .fg(th.input_placeholder_fg)
                        .bg(field_bg),
                ));
            }
            spans.push(Span::styled(
                ph,
                Style::default().fg(th.input_placeholder_fg).bg(field_bg),
            ));
            vec![Line::from(spans)]
        } else {
            paint_input_lines_ink_offset(
                &self.input,
                self.cursor,
                th.footer_bg,
                field_bg,
                show_caret,
                self.input_view_offset,
                body_w,
            )
        };
        // 无顶部分割线（对齐 Ink：EventBlock 与输入直接相接）。
        // 超长单行按 body_w 软折行（paint 与 hit-test 共用 display rows）。
        // 每行 pad 到 inp.width，避免 caret 闪烁时右侧 ghost / placeholder 半格抖
        let field_pad = Style::default().bg(field_bg);
        let padded_input: Vec<Line> = input_lines
            .into_iter()
            .map(|l| pad_line_to_width(l, inp.width as usize, field_pad))
            .collect();
        f.render_widget(
            Paragraph::new(padded_input).style(Style::default().bg(th.footer_bg)),
            inp,
        );
        // 超视口：右侧细滚动条（相对全文位置）
        if n_lines > INPUT_VIEWPORT_LINES && inp.width > 2 && inp.height > 0 {
            let max_off = n_lines.saturating_sub(INPUT_VIEWPORT_LINES);
            let start = input_view_start_with_offset(
                &self.input,
                self.cursor,
                self.input_view_offset,
                body_w,
            );
            let track_h = inp.height as usize;
            let thumb_h = ((INPUT_VIEWPORT_LINES * track_h) / n_lines).max(1).min(track_h);
            let thumb_top = if max_off == 0 {
                0
            } else {
                (start * (track_h.saturating_sub(thumb_h))) / max_off
            };
            let bar_x = inp.x.saturating_add(inp.width.saturating_sub(1));
            for i in 0..track_h {
                let y = inp.y.saturating_add(i as u16);
                let on_thumb = i >= thumb_top && i < thumb_top + thumb_h;
                let cell = if on_thumb { "▐" } else { " " };
                f.render_widget(
                    Paragraph::new(Line::from(Span::styled(
                        cell,
                        Style::default()
                            .fg(if on_thumb { th.accent } else { th.dim })
                            .bg(th.footer_bg),
                    ))),
                    Rect {
                        x: bar_x,
                        y,
                        width: 1,
                        height: 1,
                    },
                );
            }
        }

        // InfoBar (hidden when completion open — Ink Layout showComp)
        if !show_comp {
            let info = solved.get(Slot::Info).unwrap_or(Rect::default());
            let used = self.chrome.used_tokens.unwrap_or(0);
            let maxc = self.chrome.max_context.unwrap_or(0);
            let bar_w = if info.width < 50 {
                4usize
            } else if info.width < 70 {
                6
            } else {
                8
            };
            let pct = if maxc > 0 {
                (used as f64 / maxc as f64).min(1.2)
            } else {
                0.0
            };
            let filled = ((pct.min(1.0)) * bar_w as f64).round() as usize;
            let bar_fill = "█".repeat(filled);
            let bar_empty = "░".repeat(bar_w.saturating_sub(filled));
            let fill_c = if pct >= 0.7 {
                th.err
            } else if pct >= 0.5 {
                th.warn
            } else {
                th.ok
            };
            let cache = self
                .chrome
                .cache_label
                .clone()
                .unwrap_or_else(|| " c— ".into());
            let model = format!(
                "{}/{}",
                self.chrome.provider.as_deref().unwrap_or(""),
                self.model
            );
            // Ink: ` 0/200.0k ░░░░░░░░ c— ` …… model right · black ink on footerBg
            let left_txt = format!(
                " {}/{} ",
                messages::compact(used),
                messages::compact(maxc)
            );
            let right = format!(" {model} ");
            let right_w = UnicodeWidthStr::width(right.as_str());
            let mid_w = UnicodeWidthStr::width(left_txt.as_str())
                + bar_w
                + UnicodeWidthStr::width(cache.as_str())
                + right_w;
            // Ink justifyContent space-between: all free space in the middle gap
            let gap_n = (info.width as usize).saturating_sub(mid_w);
            let gap = " ".repeat(gap_n);
            let cache_fg = if self.chrome.cache_eligible {
                let p = self.chrome.cache_pct.unwrap_or(0.0);
                if p >= 50.0 {
                    th.ok
                } else if p >= 20.0 {
                    th.warn
                } else {
                    th.err
                }
            } else {
                Color::Black
            };
            // 模型名 hit：右侧 right 段
            let model_x = info
                .x
                .saturating_add(info.width.saturating_sub(right_w as u16));
            self.model_hit = Some(Rect {
                x: model_x,
                y: info.y,
                width: right_w as u16,
                height: info.height.max(1),
            });
            let model_hover = self
                .hover_id
                .as_ref()
                .map(|h| h == "model_chip")
                .unwrap_or(false);
            let model_st = if model_hover {
                Style::default()
                    .fg(Color::Black)
                    .bg(th.accent)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::Black).bg(th.footer_bg)
            };
            f.render_widget(
                Paragraph::new(Line::from(vec![
                    Span::styled(
                        left_txt,
                        Style::default().fg(Color::Black).bg(th.footer_bg),
                    ),
                    Span::styled(bar_fill, Style::default().fg(fill_c).bg(th.footer_bg)),
                    Span::styled(
                        bar_empty,
                        Style::default().fg(Color::Black).bg(th.footer_bg),
                    ),
                    Span::styled(cache, Style::default().fg(cache_fg).bg(th.footer_bg)),
                    Span::styled(gap, Style::default().bg(th.footer_bg)),
                    Span::styled(right, model_st),
                ]))
                .style(Style::default().bg(th.footer_bg)),
                info,
            );
        } else {
            self.model_hit = None;
        }

        // NavBar — Ink: equal cells (base+rem), label centered in each cell's own Rect
        // (do NOT stitch spans into one Paragraph — width/bg drift breaks visual center)
        let nav = solved.get(Slot::Nav).unwrap_or(Rect::default());
        self.nav_rect = nav;
        // 文案/色/动作均来自主题 nav_items（Node 下发），禁止本地硬编码标签
        let segs = th.nav_segs_for_draw();
        self.nav_segs.clear();
        let n = segs.len().max(1);
        let base = (nav.width as usize / n).max(1);
        let rem = (nav.width as usize).saturating_sub(base * n);
        let mut x_cursor = nav.x;
        for (i, seg) in segs.iter().enumerate() {
            let seg_r = solved.get(Slot::NavSeg(i as u16)).unwrap_or_else(|| {
                let w = (base + if i < rem { 1 } else { 0 }) as u16;
                let r = Rect::new(x_cursor, nav.y, w, nav.height.max(1));
                x_cursor = x_cursor.saturating_add(w);
                r
            });
            let w = seg_r.width as usize;
            let text = if UnicodeWidthStr::width(seg.label.as_str()) <= w {
                seg.label.as_str()
            } else {
                seg.short.as_str()
            };
            let cell = center_in_width(text, w.max(1));
            self.nav_segs.push((
                seg_r.x,
                seg_r.x.saturating_add(seg_r.width),
                seg.id.clone(),
                seg.action_kind.clone(),
                seg.action_value.clone(),
            ));
            let hovered = self
                .hover_id
                .as_ref()
                .map(|h| h == &format!("nav:{}", seg.id))
                .unwrap_or(false);
            let (fg, bgc) = if hovered {
                (seg.fg_hover, seg.bg_hover)
            } else {
                (seg.fg, seg.bg)
            };
            let nav_line = pad_line_to_width(
                Line::from(Span::styled(
                    cell,
                    Style::default()
                        .fg(fg)
                        .bg(bgc)
                        .add_modifier(Modifier::BOLD),
                )),
                w.max(1),
                Style::default().bg(bgc),
            );
            f.render_widget(
                Paragraph::new(nav_line).style(Style::default().bg(bgc)),
                seg_r,
            );
        }

        // Overlay modal — absolute center from layout
        self.overlay_rect = None;
        if let Some(o) = &self.overlay {
            let rect = solved
                .get(Slot::Overlay)
                .unwrap_or_else(|| crate::layout::place_absolute_center(area, overlay_w, overlay_h));
            let h = rect.height;
            self.overlay_rect = Some(rect);
            f.render_widget(Clear, rect);
            let block = Block::default()
                .borders(Borders::ALL)
                .title(format!(" {} ", o.title))
                .border_style(Style::default().fg(th.accent));
            let mut body: Vec<Line> = Vec::new();
            if let Some(lines) = &o.lines {
                // help / prompt dump: scrollable text
                let inner_h = h.saturating_sub(3) as usize; // borders + footer
                let max_scroll = lines.len().saturating_sub(inner_h.max(1));
                if self.overlay_scroll > max_scroll {
                    self.overlay_scroll = max_scroll;
                }
                let from = self.overlay_scroll;
                let to = (from + inner_h).min(lines.len());
                self.overlay_list_from = from;
                self.overlay_list_count = to.saturating_sub(from);
                for l in lines.iter().take(to).skip(from) {
                    body.push(Line::from(Span::styled(
                        l.clone(),
                        Style::default().fg(th.fg),
                    )));
                }
            } else {
                // Ink SelectList: windowed + ❯ pointer + hover highlight
                let n = o.items.len();
                let inner_h = h.saturating_sub(3) as usize; // borders + footer
                let vis = inner_h.min(n).max(1).min(12);
                let from = self
                    .overlay_sel
                    .saturating_sub(vis / 2)
                    .min(n.saturating_sub(vis));
                let to = (from + vis).min(n);
                self.overlay_list_from = from;
                self.overlay_list_count = to.saturating_sub(from);
                for i in from..to {
                    let it = &o.items[i];
                    let desc = it.description.clone().unwrap_or_default();
                    let hovered = self.overlay_hover == Some(i);
                    let selected = i == self.overlay_sel;
                    body.push(select_row(
                        &it.label,
                        &desc,
                        selected || hovered,
                        &th,
                    ));
                }
            }
            let foot = if o.lines.as_ref().map(|l| l.len()).unwrap_or(0) > 0 {
                let n = o.lines.as_ref().map(|l| l.len()).unwrap_or(0);
                format!(
                    " {}  · 行 {}/{} · ↑↓ 滚动 · Esc 关闭 ",
                    o.footer,
                    self.overlay_scroll.saturating_add(1).min(n.max(1)),
                    n.max(1)
                )
            } else {
                format!(" {} ", o.footer)
            };
            body.push(Line::from(Span::styled(
                foot,
                Style::default().fg(th.dim),
            )));
            f.render_widget(
                Paragraph::new(body)
                    .block(block)
                    .style(Style::default().bg(th.panel_bg)),
                rect,
            );
        }

        // Selection overlay LAST — same 0-based screen coords as crossterm mouse
        let text_x0 = self.input_text_x0();
        let chat_inner = self.chat_inner;
        let vis = self.visible_start;
        let input_rect = self.input_rect;
        let input = self.input.clone();
        let view_start = input_view_start_with_offset(
            &input,
            self.cursor,
            self.input_view_offset,
            self.input_body_width(),
        );
        self.sel.apply_overlay(
            f.buffer_mut(),
            chat_inner,
            vis,
            input_rect,
            &input,
            text_x0,
            view_start,
        );
    }

    pub(crate) fn build_scroll_lines(&mut self, width: usize, body_h: usize) -> Vec<Line<'static>> {
        let th = self.theme.clone();
        // Ink GallerySplash: logo 左上贴顶 + 画/铭牌水平居中 + 光学垂直留白
        if self.messages.is_empty() {
            self.scroll_render_cache = None;
            return self.build_gallery_splash(width.max(8), body_h.max(1), &th);
        }
        let hist = self.chrome.history_base.unwrap_or(200) as usize;
        // Cheap cache key: O(1) 摘要，禁止每帧 join 全部消息 id（121 条时很重）
        let spin_q = self.spinner_frame / 4;
        let last = self.messages.last();
        let content_sum: u64 = self.messages.iter().map(|m| m.content.len() as u64).sum();
        let tools_n: usize = self.messages.iter().map(|m| m.tool_cards.len()).sum();
        let think_n: usize = self
            .messages
            .iter()
            .map(|m| m.thinking_blocks.len())
            .sum();
        let cache_key = format!(
            "w{width}|h{hist}|sp{spin_q}|n{}|c{content_sum}|t{tools_n}|k{think_n}|e{}|x{}|r{}|L{}:{}:{}",
            self.messages.len(),
            self.system_events.len(),
            self.expanded_system_events.len(),
            self.expanded_tool_results.len(),
            last.map(|m| m.id.as_str()).unwrap_or(""),
            last.map(|m| m.content.len()).unwrap_or(0),
            last.map(|m| m.streaming).unwrap_or(false),
        );
        if let Some((ref k, w, ref lines, ref hits)) = self.scroll_render_cache {
            if *k == cache_key && w == width {
                self.tool_hits = hits.tools.clone();
                self.msg_expand_hits = hits.expands.clone();
                self.thinking_hits = hits.thinking.clone();
                self.system_event_hits = hits.system_events.clone();
                self.tool_result_hits = hits.tool_results.clone();
                return lines.clone();
            }
        }
        let (lines, hits) = render_messages(
            &self.messages,
            &self.system_events,
            width,
            &th,
            hist,
            self.spinner_frame,
            &self.expanded_system_events,
            &self.expanded_tool_results,
        );
        self.tool_hits = hits.tools.clone();
        self.msg_expand_hits = hits.expands.clone();
        self.thinking_hits = hits.thinking.clone();
        self.system_event_hits = hits.system_events.clone();
        self.tool_result_hits = hits.tool_results.clone();
        self.scroll_render_cache = Some((cache_key, width, lines.clone(), hits));
        lines
    }

    /// Ink `GallerySplash`：
    /// ① logo 左上（marginLeft=1，accent，不参与垂直居中）
    /// ② 光学上留白（top+2）
    /// ③ 画框 / 铭牌水平居中
    /// ④ 下方光学留白
    fn build_gallery_splash(
        &self,
        width: usize,
        body_h: usize,
        th: &crate::theme::Theme,
    ) -> Vec<Line<'static>> {
        use crate::maou_logo::{center_gallery_line, gallery_vertical_pads, maou_logo_lines};

        let mut out: Vec<Line<'static>> = Vec::new();
        let pad_bg = Style::default().fg(th.fg).bg(th.bg);

        // 与 `GALLERY_MIN_HANG_ROWS_FOR_ART`（sm 17 + 铭牌 3 + 呼吸 2 = 22）对齐。
        // 挂画区过矮 / 无画：居中品牌块（logo + 分隔 + 标题/版本 + studio）。
        const GALLERY_MIN_HANG_FOR_ART: usize = 22;
        let logo_corner = maou_logo_lines();
        let logo_h = logo_corner.len(); // 横构仅 3 行，无上下加行
        let hang_area = body_h.saturating_sub(logo_h);
        let show_art =
            hang_area >= GALLERY_MIN_HANG_FOR_ART && !self.gallery_lines.is_empty();

        if !show_art {
            // 竖构无油画：居中静态品牌块
            return self.build_compact_brand_splash(width, body_h, th);
        }

        // ① 有油画：横构 logo 三行 —— 蓝底 + 白字（不加上下空行）
        let logo_bar = Style::default()
            .fg(Color::Rgb(255, 255, 255))
            .bg(th.info);
        for ln in &logo_corner {
            let row = Line::from(Span::styled(format!(" {ln}"), logo_bar));
            out.push(pad_line_to_width(row, width, logo_bar));
        }

        // hang = art + plaque from Node (no logo)
        let hang_src: Vec<&str> = self
            .gallery_lines
            .iter()
            .map(|s| s.as_str())
            .collect();

        // 识别：首块非空行为画；空行后为铭牌（标题更亮）
        let mut art: Vec<&str> = Vec::new();
        let mut plaque: Vec<&str> = Vec::new();
        let mut seen_blank = false;
        let mut started = false;
        for line in &hang_src {
            if !started {
                if line.is_empty() {
                    continue;
                }
                started = true;
                art.push(line);
                continue;
            }
            if !seen_blank && line.is_empty() {
                seen_blank = true;
                continue;
            }
            if seen_blank {
                plaque.push(line);
            } else {
                art.push(line);
            }
        }
        if plaque.is_empty() && art.len() > 2 {
            // Node fallback: last 1–2 lines may be caption without blank
            // Keep as art if looks like frame; else leave as-is
        }

        // 铭牌前 1 行呼吸（Ink）
        let plaque_h = if plaque.is_empty() {
            0
        } else {
            1 + plaque.len()
        };
        let hang_h = art.len() + plaque_h;
        let (pad_top, pad_bot) = gallery_vertical_pads(hang_area, hang_h);
        // Ink: 画作起点再下移 2 格（光学 top+2）
        let free = pad_top + pad_bot;
        let above = if free == 0 {
            0
        } else {
            (pad_top + 2).min(free)
        };
        let below = free.saturating_sub(above);

        for _ in 0..above {
            out.push(pad_line_to_width(Line::from(""), width, pad_bg));
        }

        // ③ 画：水平居中，正文色
        for ln in &art {
            let centered = center_gallery_line(ln, width);
            let row = Line::from(Span::styled(
                centered,
                Style::default().fg(th.fg).bg(th.bg),
            ));
            out.push(pad_line_to_width(row, width, pad_bg));
        }

        // ④ 铭牌
        if !plaque.is_empty() {
            out.push(pad_line_to_width(Line::from(""), width, pad_bg));
            for (i, ln) in plaque.iter().enumerate() {
                let centered = center_gallery_line(ln, width);
                let st = if i == 0 {
                    Style::default()
                        .fg(th.fg)
                        .bg(th.bg)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(th.muted).bg(th.bg)
                };
                out.push(pad_line_to_width(
                    Line::from(Span::styled(centered, st)),
                    width,
                    pad_bg,
                ));
            }
        }

        for _ in 0..below {
            out.push(pad_line_to_width(Line::from(""), width, pad_bg));
        }

        // 至少占满视口，避免 follow 把 logo 卷走；full-width pad 防残影
        while out.len() < body_h {
            out.push(pad_line_to_width(Line::from(""), width, pad_bg));
        }
        out
    }

    /// 竖构开屏（无油画）：居中静态品牌块。
    fn build_compact_brand_splash(
        &self,
        width: usize,
        body_h: usize,
        th: &crate::theme::Theme,
    ) -> Vec<Line<'static>> {
        use crate::maou_logo::{center_block_lines_inner, compact_brand_block};

        let brand = compact_brand_block(&crate::maou_logo::cli_version());
        let centered = center_block_lines_inner(&brand, width);
        let brand_h = centered.len();
        let free = body_h.saturating_sub(brand_h);
        let pad_top = free / 2;
        let pad_bot = free.saturating_sub(pad_top);
        let pad_bg = Style::default().fg(th.fg).bg(th.bg);
        let brand_st = Style::default().fg(th.accent).bg(th.bg);

        let mut out: Vec<Line<'static>> = Vec::with_capacity(body_h);
        for _ in 0..pad_top {
            out.push(pad_line_to_width(Line::from(""), width, pad_bg));
        }
        for ln in &centered {
            let row = Line::from(Span::styled(ln.clone(), brand_st));
            out.push(pad_line_to_width(row, width, pad_bg));
        }
        for _ in 0..pad_bot {
            out.push(pad_line_to_width(Line::from(""), width, pad_bg));
        }
        while out.len() < body_h {
            out.push(pad_line_to_width(Line::from(""), width, pad_bg));
        }
        out
    }
}
