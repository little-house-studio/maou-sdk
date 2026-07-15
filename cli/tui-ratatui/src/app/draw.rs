//! Frame layout + paint (chat, chrome, overlays).

use super::input_paint::{
    input_height, input_view_start, paint_input_lines_ink, center_in_width, trim_to_width,
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

impl App {
    pub fn note_frame(&mut self) {
        let now = Instant::now();
        self.frame_times.push_back(now);
        while self.frame_times.len() > 30 {
            self.frame_times.pop_front();
        }
        if self.frame_times.len() >= 2 {
            let dt = now
                .duration_since(*self.frame_times.front().unwrap())
                .as_secs_f32();
            if dt > 0.0 {
                self.fps = (self.frame_times.len() as f32 - 1.0) / dt;
            }
        }
        if self.streaming || self.messages.iter().any(|m| m.streaming) {
            self.spinner_frame = self.spinner_frame.wrapping_add(1);
        }
    }

    pub fn draw(&mut self, f: &mut Frame) {
        let area = f.area();
        let th = self.theme.clone();
        self.screen_cols = area.width;
        self.screen_rows = area.height;

        // After Terminal::clear the buffer is empty — paint a full-frame base so no
        // region is left as "undefined" if a widget skips a row.
        f.render_widget(
            Block::default().style(Style::default().bg(th.bg).fg(th.fg)),
            area,
        );

        // ── Shell metrics (Ink Layout.tsx heights) → integer flex tree ──
        self.purge_toast();
        let has_approval = self.terminal_approval.is_some();
        let has_toast = self.local_toast.is_some() || self.chrome.toast.is_some();
        let show_back = self.scroll_from_bottom > 0;
        let show_jump = self.scroll_from_bottom > 2;
        let empty = self.messages.is_empty();
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
        let input_h = input_height(&self.input) as u16;

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
            nav_seg_count: ShellMetrics::nav_count(),
            overlay_w,
            overlay_h,
            full_editor: self.full_editor,
        };
        let solved = solve_shell(&metrics, area);

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

        // chat body from layout slots (border padding + optional jump bar)
        let chat = solved.get(Slot::Chat).unwrap_or(area);
        self.chat_rect = chat;
        self.chat_inner = solved.get(Slot::ChatInner).unwrap_or(Rect {
            x: chat.x.saturating_add(1),
            y: chat.y.saturating_add(1),
            width: chat.width.saturating_sub(2),
            height: chat.height.saturating_sub(2),
        });
        self.jump_prev_y = solved.get(Slot::JumpPrev).map(|r| r.y);
        self.tool_hits.clear();
        self.msg_expand_hits.clear();
        self.thinking_hits.clear();
        self.system_event_hits.clear();
        self.tool_result_hits.clear();
        // wrap width MUST equal chat_inner.width (same grid mouse hits)
        let body_h = self.chat_inner.height.max(1) as usize;
        let mut lines =
            self.build_scroll_lines(self.chat_inner.width.max(1) as usize, body_h);
        // Ink BOTTOM_PAD + Grok follow: when at latest, pad empty rows under content
        // so a new send / AI stream has room in the lower viewport.
        // Empty gallery splash already fills viewport with logo at top — do not pad
        // or follow-tail would scroll the first logo row off-screen.
        let tail_pad = if self.messages.is_empty() {
            0
        } else {
            self.follow_tail_pad_lines(body_h)
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
        self.max_scroll_lines = max_scroll;
        // Empty splash: top-align (Ink logo flexShrink=0 贴顶，overflow 裁下方)
        if self.messages.is_empty() {
            self.scroll_from_bottom = max_scroll as u16;
        } else if self.scroll_from_bottom == 0 {
            // Following: force from_bottom=0 so growth sticks to latest (Ink autoFollow)
        } else if self.scroll_from_bottom as usize > max_scroll {
            self.scroll_from_bottom = max_scroll as u16;
        }
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
            let hovered = self.hover_id.as_ref().map(|h| {
                self.tool_hits
                    .iter()
                    .any(|t| t.line_idx == logical && h == &format!("tool:{}", t.tool_id))
                    || self.thinking_hits.iter().any(|t| {
                        t.line_idx == logical && h == &format!("think:{}", t.thinking_id)
                    })
                    || self.msg_expand_hits.iter().any(|e| {
                        e.line_idx == logical && h == &format!("expand:{}", e.message_id)
                    })
                    || self.system_event_hits.iter().any(|s| {
                        s.line_idx == logical && h == &format!("sys:{}", s.event_id)
                    })
            }).unwrap_or(false);
            if hovered {
                visible.push(Line::from(Span::styled(
                    plain,
                    Style::default().fg(th.fg).bg(th.panel_bg),
                )));
            } else {
                visible.push(line.clone());
            }
        }
        // Fill viewport so leftover cells never flash stale/blank holes mid-stream
        while visible.len() < body_h {
            visible.push(Line::from(""));
        }

        let title = if empty {
            " maou ".to_string()
        } else if from_bottom > 0 {
            format!(" {} · ↑{} ", self.messages.len(), from_bottom)
        } else {
            format!(" {} ", self.messages.len())
        };
        let _ = max_scroll;
        // 1) Border chrome only (full chat slot)
        f.render_widget(
            Block::default()
                .borders(Borders::ALL)
                .title(title)
                .border_style(Style::default().fg(th.border)),
            chat,
        );
        // 2) Message body strictly in ChatInner (layout slot)
        f.render_widget(Paragraph::new(visible), self.chat_inner);
        // 3) Jump bar last so it is never covered by the body Paragraph
        if let Some(jr) = solved.get(Slot::JumpPrev) {
            self.jump_prev_y = Some(jr.y);
            let preview = self.prev_user_jump_label(jr.width as usize);
            f.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    trunc(&preview, jr.width as usize),
                    Style::default()
                        .fg(th.user)
                        .bg(th.user_bg)
                        .add_modifier(Modifier::BOLD),
                )))
                .style(Style::default().bg(th.user_bg)),
                jr,
            );
        }

        // PerfHud (top-right of chat) — Ink 5-line process-stats when Node sends perf_lines
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
            if chat.width > max_w + 2 && chat.height > n {
                let hr = Rect {
                    x: chat.x.saturating_add(chat.width.saturating_sub(max_w + 1)),
                    y: chat.y,
                    width: max_w.min(chat.width),
                    height: n.min(chat.height),
                };
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
                        // right-pad for block alignment
                        let pad = max_w.saturating_sub(UnicodeWidthStr::width(l.as_str()) as u16);
                        let text = format!("{l}{}", " ".repeat(pad as usize));
                        Line::from(Span::styled(
                            text,
                            Style::default()
                                .fg(color)
                                .bg(th.panel_bg)
                                .add_modifier(if i == 0 {
                                    Modifier::BOLD
                                } else {
                                    Modifier::empty()
                                }),
                        ))
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
        if has_approval {
            let a = &self.terminal_approval.as_ref().unwrap();
            let r = match solved.get(Slot::Approval) {
                Some(r) => r,
                None => Rect::default(),
            };
            self.approval_rect = Some(r);
            // Ink TerminalApprovalBar: bar bg + per-chip hover (Y/A/N/B markers stable for hit)
            let cmd = trunc(&a.command, (r.width as usize).saturating_sub(48).max(8));
            let hint = a.hint.clone().unwrap_or_default();
            let bar_bg = th.warn;
            let chip = |key: &str, label: &str, choice: &str| -> Span<'static> {
                let hot = self
                    .approval_hover
                    .as_deref()
                    .map(|h| h == choice)
                    .unwrap_or(false);
                let (fg, bg) = if hot {
                    (Color::Black, th.accent)
                } else {
                    (Color::Black, bar_bg)
                };
                Span::styled(
                    format!("[{key}]{label} "),
                    Style::default()
                        .fg(fg)
                        .bg(bg)
                        .add_modifier(Modifier::BOLD),
                )
            };
            let spans = vec![
                Span::styled(
                    format!(" 审批 · {cmd}  "),
                    Style::default()
                        .fg(Color::Black)
                        .bg(bar_bg)
                        .add_modifier(Modifier::BOLD),
                ),
                chip("Y", "一次", "y"),
                chip("A", "总是", "a"),
                chip("N", "拒绝", "n"),
                chip("B", "拉黑", "b"),
                Span::styled(
                    format!(" {hint}"),
                    Style::default().fg(Color::Black).bg(bar_bg),
                ),
            ];
            f.render_widget(
                Paragraph::new(Line::from(spans)).style(Style::default().bg(bar_bg)),
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
            let raw = format!("{prefix}{text}");
            let line = center(&raw, r.width as usize);
            f.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    line,
                    Style::default()
                        .fg(fg)
                        .bg(bg)
                        .add_modifier(Modifier::BOLD),
                ))),
                r,
            );
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
        if show_comp {
            let r = match solved.get(Slot::Completion) {
                Some(r) => r,
                None => Rect::default(),
            };
            self.completion_rect = Some(r);
            let c = self.completions.as_ref().unwrap();
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
            if self.chrome.event_block_expanded && sup_active {
                // Ink EventBlockExpanded
                let sup = self.chrome.supervisor.as_ref().unwrap();
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
                        if msg.ends_with('\n') || msg.is_empty() {
                            // keep spacing
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

        // Input — Ink: footerBg shell + " ❯ " black + inputFieldBg body (multi-line TextArea)
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
        let input_lines = if self.input.is_empty() {
            let mut spans = vec![Span::styled(
                mouse::PROMPT_STR.to_string(),
                Style::default()
                    .fg(Color::Black)
                    .bg(th.footer_bg)
                    .add_modifier(Modifier::BOLD),
            )];
            if show_caret {
                spans.push(Span::styled(
                    "▌".to_string(),
                    Style::default().fg(Color::Black).bg(field_bg),
                ));
            }
            spans.push(Span::styled(
                ph,
                Style::default().fg(th.input_placeholder_fg).bg(field_bg),
            ));
            vec![Line::from(spans)]
        } else {
            paint_input_lines_ink(
                &self.input,
                self.cursor,
                th.footer_bg,
                field_bg,
                show_caret,
            )
        };
        // 无顶部分割线（对齐 Ink：EventBlock 与输入直接相接）。
        // 禁止 soft-wrap：逻辑行 = 鼠标 hit 行，避免 input_visual_to_byte 错位（M09）。
        f.render_widget(
            Paragraph::new(input_lines).style(Style::default().bg(th.footer_bg)),
            inp,
        );

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
            let mid_w = UnicodeWidthStr::width(left_txt.as_str())
                + bar_w
                + UnicodeWidthStr::width(cache.as_str())
                + UnicodeWidthStr::width(right.as_str());
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
                    Span::styled(right, Style::default().fg(Color::Black).bg(th.footer_bg)),
                ]))
                .style(Style::default().bg(th.footer_bg)),
                info,
            );
        }

        // NavBar — Ink: equal cells (base+rem), label centered in each cell's own Rect
        // (do NOT stitch spans into one Paragraph — width/bg drift breaks visual center)
        let nav = solved.get(Slot::Nav).unwrap_or(Rect::default());
        self.nav_rect = nav;
        let segs: [(&str, &str, &str, Color); 7] = [
            ("agent", "agent", "ag", th.nav_agent),
            ("sessions", "会话", "会话", th.nav_sessions),
            ("terminal", "终端", "终端", th.nav_terminal),
            ("todo", "任务", "任务", th.nav_todo),
            ("inbox", "收件箱", "收件", th.nav_inbox),
            ("notice", "公告", "公告", th.nav_notice),
            ("settings", "设置", "设置", th.nav_settings),
        ];
        self.nav_segs.clear();
        // Prefer layout slots; if missing, fall back to Ink base/rem split
        let n = segs.len();
        let base = (nav.width as usize / n).max(1);
        let rem = (nav.width as usize).saturating_sub(base * n);
        let mut x_cursor = nav.x;
        for (i, (id, label, short, bg)) in segs.iter().enumerate() {
            let seg_r = solved.get(Slot::NavSeg(i as u16)).unwrap_or_else(|| {
                let w = (base + if i < rem { 1 } else { 0 }) as u16;
                let r = Rect::new(x_cursor, nav.y, w, nav.height.max(1));
                x_cursor = x_cursor.saturating_add(w);
                r
            });
            let w = seg_r.width as usize;
            // Ink centerInWidth(text, short, width)
            let text = if UnicodeWidthStr::width(*label) <= w {
                *label
            } else {
                *short
            };
            let cell = center_in_width(text, w.max(1));
            self.nav_segs
                .push((seg_r.x, seg_r.x.saturating_add(seg_r.width), id));
            let hovered = self
                .hover_id
                .as_ref()
                .map(|h| h == &format!("nav:{id}"))
                .unwrap_or(false);
            let (fg, bgc) = if hovered {
                (Color::Black, th.accent)
            } else {
                (Color::Black, *bg)
            };
            f.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    cell,
                    Style::default()
                        .fg(fg)
                        .bg(bgc)
                        .add_modifier(Modifier::BOLD),
                )))
                .style(Style::default().bg(bgc)),
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
                for l in lines.iter().take(h as usize - 3) {
                    body.push(Line::from(Span::styled(
                        l.clone(),
                        Style::default().fg(th.fg),
                    )));
                }
            } else {
                // Ink SelectList: windowed + ❯ pointer
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
                    body.push(select_row(
                        &it.label,
                        &desc,
                        i == self.overlay_sel,
                        &th,
                    ));
                }
            }
            body.push(Line::from(Span::styled(
                format!(" {} ", o.footer),
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
        let view_start = input_view_start(&input, self.cursor);
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
            return self.build_gallery_splash(width.max(8), body_h.max(1), &th);
        }
        let hist = self.chrome.history_base.unwrap_or(200) as usize;
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
        self.tool_hits = hits.tools;
        self.msg_expand_hits = hits.expands;
        self.thinking_hits = hits.thinking;
        self.system_event_hits = hits.system_events;
        self.tool_result_hits = hits.tool_results;
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
        use crate::maou_logo::{
            center_gallery_line, gallery_vertical_pads, maou_logo_lines,
        };

        let mut out: Vec<Line<'static>> = Vec::new();

        // ① 左上像素标：贴顶，不居中
        let logo = maou_logo_lines();
        let logo_h = logo.len();
        for ln in &logo {
            // Ink: marginLeft={1}
            out.push(Line::from(Span::styled(
                format!(" {ln}"),
                Style::default()
                    .fg(th.accent)
                    .add_modifier(Modifier::BOLD),
            )));
        }

        // hang = art + plaque from Node (no logo)
        let hang_src: Vec<&str> = if self.gallery_lines.is_empty() {
            vec!["", "  输入消息开始对话"]
        } else {
            self.gallery_lines.iter().map(|s| s.as_str()).collect()
        };

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
        let hang_area = body_h.saturating_sub(logo_h);
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
            out.push(Line::from(""));
        }

        // ③ 画：水平居中，正文色
        for ln in &art {
            let centered = center_gallery_line(ln, width);
            out.push(Line::from(Span::styled(
                centered,
                Style::default().fg(th.fg),
            )));
        }

        // ④ 铭牌
        if !plaque.is_empty() {
            out.push(Line::from(""));
            for (i, ln) in plaque.iter().enumerate() {
                let centered = center_gallery_line(ln, width);
                let st = if i == 0 {
                    Style::default()
                        .fg(th.fg)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(th.muted)
                };
                out.push(Line::from(Span::styled(centered, st)));
            }
        }

        for _ in 0..below {
            out.push(Line::from(""));
        }

        // 至少占满视口，避免 follow 把 logo 卷走
        while out.len() < body_h {
            out.push(Line::from(""));
        }
        out
    }
}
