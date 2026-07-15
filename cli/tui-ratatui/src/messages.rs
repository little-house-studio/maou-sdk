//! Message rendering aligned with Ink MessageRow / MsgLayout / ToolCard dumps.

use crate::markdown::{render_markdown, wrap_str};
use crate::protocol::{ProtoSystemEvent, ProtoToolCard, UiMessage};
use crate::theme::Theme;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use unicode_width::UnicodeWidthStr;

pub const LOGO_W: usize = 2;

pub fn pad_logo(logo: &str) -> String {
    let chars: Vec<char> = logo.chars().collect();
    if chars.is_empty() {
        return " ".repeat(LOGO_W);
    }
    if chars.len() >= LOGO_W {
        return chars[..LOGO_W].iter().collect();
    }
    let mut s: String = chars.iter().collect();
    s.push_str(&" ".repeat(LOGO_W - chars.len()));
    s
}

pub fn logo_empty() -> String {
    " ".repeat(LOGO_W)
}

fn timecode(ts_ms: Option<u64>) -> String {
    use std::time::UNIX_EPOCH;
    let ms = ts_ms.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    });
    // Prefer local wall clock if available via chrono-less approximation:
    // use system local offset when possible.
    #[cfg(unix)]
    {
        let secs = (ms / 1000) as i64;
        // libc localtime
        unsafe {
            let mut t = secs as libc::time_t;
            let tm = libc::localtime(&mut t);
            if !tm.is_null() {
                let h = (*tm).tm_hour as u32;
                let m = (*tm).tm_min as u32;
                let s = (*tm).tm_sec as u32;
                return format!("{h:02}:{m:02}:{s:02}");
            }
        }
    }
    let secs = (ms / 1000) as i64;
    let h = ((secs % 86400) / 3600) as u32;
    let m = ((secs % 3600) / 60) as u32;
    let s = (secs % 60) as u32;
    format!("{h:02}:{m:02}:{s:02}")
}

/// Ink compact(): 200000 → 200.0k
pub fn compact(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1000 {
        format!("{:.1}k", n as f64 / 1000.0)
    } else {
        n.to_string()
    }
}

/// Ink `durationStr`: ms → 350ms / 1.2s / 2.5min
fn duration_str(ms: Option<u64>) -> String {
    match ms {
        None | Some(0) => String::new(),
        Some(d) if d < 1000 => format!("{d}ms"),
        Some(d) if d < 60_000 => format!("{:.1}s", d as f64 / 1000.0),
        Some(d) => format!("{:.1}min", d as f64 / 60_000.0),
    }
}

/// Ink `shortId`: `/^m?u?/` then first 6 chars
fn short_id(id: &str) -> String {
    let mut s = id;
    if let Some(rest) = s.strip_prefix('m') {
        s = rest;
    }
    if let Some(rest) = s.strip_prefix('u') {
        s = rest;
    }
    s.chars().take(6).collect()
}

/// Ink `loopMark(round, 0)` → ↺N
fn loop_mark(round: u32) -> String {
    format!("↺{round}")
}

#[derive(Clone)]
pub struct ToolHit {
    pub line_idx: usize,
    pub message_id: String,
    pub tool_id: String,
}

#[derive(Clone)]
pub struct ExpandHit {
    pub line_idx: usize,
    pub message_id: String,
}

/// Click thinking header → ThinkingToggle (Ink ThinkingBlock useClickTarget).
#[derive(Clone)]
pub struct ThinkingHit {
    pub line_idx: usize,
    pub thinking_id: String,
}

/// Click system event banner → toggle local detail (Ink SystemEventRow open state).
#[derive(Clone)]
pub struct SystemEventHit {
    pub line_idx: usize,
    pub event_id: String,
}

/// Click tool result fold line → toggle full result (Ink DiffCollapsible).
#[derive(Clone)]
pub struct ToolResultHit {
    pub line_idx: usize,
    pub tool_id: String,
}

pub struct RenderHits {
    pub tools: Vec<ToolHit>,
    pub expands: Vec<ExpandHit>,
    pub thinking: Vec<ThinkingHit>,
    pub system_events: Vec<SystemEventHit>,
    pub tool_results: Vec<ToolResultHit>,
}

fn parse_args(args: &str) -> (String, String, String) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(args) {
        if let Some(obj) = v.as_object() {
            let reason = obj
                .get("reason")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let target = [
                "path",
                "file_path",
                "command",
                "pattern",
                "query",
                "name",
                "url",
            ]
            .iter()
            .find_map(|k| obj.get(*k).and_then(|x| x.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();
            let pretty = serde_json::to_string_pretty(&v).unwrap_or_else(|_| args.to_string());
            return (reason, target, pretty);
        }
    }
    (
        String::new(),
        args.chars().take(40).collect(),
        args.to_string(),
    )
}

fn is_write_tool(name: &str) -> bool {
    matches!(
        name,
        "create"
            | "edit"
            | "write"
            | "patch"
            | "rm"
            | "remove"
            | "mkdir"
            | "move"
            | "write_file"
            | "edit_file"
    )
}

fn is_diff_result(s: &str) -> bool {
    s.lines().take(20).any(|l| {
        l.starts_with("@@")
            || l.starts_with("+++ ")
            || l.starts_with("--- ")
            || (l.starts_with('+') && !l.starts_with("++"))
            || (l.starts_with('-') && !l.starts_with("--"))
    })
}

/// Render messages → lines + hit targets (Ink dump layout).
/// Ink `systemEventSymbol` (decorators.ts)
pub fn system_event_symbol(kind: &str) -> &'static str {
    match kind {
        "compress" => "🗜",
        "abort" => "✕",
        "retry_fail" => "↻",
        "hook" => "⚓",
        "permission" => "🔓",
        "env_error" => "⚠",
        "agent_message" => "✉",
        "runtime_control" => "↻",
        "system_notice" => "📋",
        "session_inject" => "↓",
        _ => "ℹ",
    }
}

/// Ink SystemEventRow KIND_COLOR → theme tokens
fn system_event_color(kind: &str, theme: &Theme) -> Color {
    match kind {
        "compress" | "retry_fail" | "runtime_control" => theme.warn,
        "abort" | "env_error" => theme.err,
        "hook" | "agent_message" => theme.accent2,
        "permission" | "system_notice" => theme.info,
        _ => theme.dim,
    }
}

/// Ink SystemEventRow: `>>>>[sym content | ts]<<<<` full-width banner
pub fn render_system_event_line(
    kind: &str,
    content: &str,
    ts: Option<u64>,
    width: usize,
    theme: &Theme,
) -> Line<'static> {
    let w = width.max(10);
    let sym = system_event_symbol(kind);
    let tc = timecode(ts);
    let body = trunc(content, w.saturating_sub(sym.chars().count() + tc.len() + 10).max(4));
    let inner = format!("[{sym} {body} | {tc}]");
    let inner_w = UnicodeWidthStr::width(inner.as_str());
    let pad_total = w.saturating_sub(inner_w);
    let pad_left = pad_total / 2;
    let pad_right = pad_total - pad_left;
    let line = format!(
        "{}{}{}",
        ">".repeat(pad_left),
        inner,
        "<".repeat(pad_right)
    );
    Line::from(Span::styled(
        line,
        Style::default().fg(system_event_color(kind, theme)),
    ))
}

pub fn render_messages(
    messages: &[UiMessage],
    system_events: &[ProtoSystemEvent],
    width: usize,
    theme: &Theme,
    history_base: usize,
    spinner_frame: u64,
    // Event ids with detail expanded (Ink SystemEventRow `open` local state).
    expanded_system_events: &std::collections::HashSet<String>,
    // Tool ids with full result/diff expanded (Ink DiffCollapsible).
    expanded_tool_results: &std::collections::HashSet<String>,
) -> (Vec<Line<'static>>, RenderHits) {
    let w = width.max(20);
    let mut out: Vec<Line<'static>> = Vec::new();
    let mut hits = RenderHits {
        tools: vec![],
        expands: vec![],
        thinking: vec![],
        system_events: vec![],
        tool_results: vec![],
    };

    // Ink SystemEventRow: >>>>[sym content | ts]<<<< ; detail only when open
    for ev in system_events {
        let has_detail = ev
            .detail
            .as_ref()
            .map(|d| !d.trim().is_empty())
            .unwrap_or(false);
        let open = has_detail && expanded_system_events.contains(&ev.id);
        hits.system_events.push(SystemEventHit {
            line_idx: out.len(),
            event_id: ev.id.clone(),
        });
        out.push(render_system_event_line(
            &ev.kind,
            &ev.content,
            ev.ts,
            w,
            theme,
        ));
        if open {
            if let Some(detail) = &ev.detail {
                let total = detail.lines().count();
                for chunk in wrap_str(detail, w.saturating_sub(LOGO_W + 1)) {
                    // detail lines also toggle (Ink whole-row click target)
                    hits.system_events.push(SystemEventHit {
                        line_idx: out.len(),
                        event_id: ev.id.clone(),
                    });
                    out.push(body_line(&chunk, Style::default().fg(theme.dim)));
                }
                if total > 12 {
                    hits.system_events.push(SystemEventHit {
                        line_idx: out.len(),
                        event_id: ev.id.clone(),
                    });
                    out.push(body_line(
                        &format!("…（共 {total} 行详情 · 再点收起）"),
                        Style::default().fg(theme.dim),
                    ));
                }
            }
        } else if has_detail {
            // collapsed affordance (also clickable)
            hits.system_events.push(SystemEventHit {
                line_idx: out.len(),
                event_id: ev.id.clone(),
            });
            out.push(body_line(
                "  ▶ 详情（点击展开）",
                Style::default().fg(theme.dim),
            ));
        }
    }

    let slice: &[UiMessage] = if messages.len() > history_base {
        &messages[messages.len() - history_base..]
    } else {
        messages
    };

    for m in slice {
        let label = m
            .author_label
            .clone()
            .unwrap_or_else(|| match m.role.as_str() {
                "user" => "user".into(),
                "assistant" => "agent:coding".into(),
                other => other.into(),
            });
        let tc = timecode(m.ts);

        match m.role.as_str() {
            "user" => {
                let kind = m.kind.as_deref().unwrap_or("human_user");
                // Ink: non-human user kinds render as system notice (▣)
                let notice = matches!(
                    kind.split('|').next().unwrap_or(kind),
                    "system_notice" | "runtime_control" | "agent_message" | "compact" | "unknown"
                );
                if notice {
                    let sid = short_id(&m.id);
                    out.push(head_line(
                        "▣",
                        &format!("{sid} | {label} | {tc}"),
                        theme.system,
                        false,
                    ));
                    for chunk in wrap_str(&m.content, w.saturating_sub(LOGO_W + 1)) {
                        out.push(body_line(&chunk, Style::default().fg(theme.system)));
                    }
                    out.push(Line::from(""));
                    continue;
                }

                // Ink UserBubble: shortId | who | ts | ↑tok [| queued]
                let sid = short_id(&m.id);
                let mut head = format!("{sid} | {label} | {tc}");
                if let Some(up) = m.usage_input {
                    if up > 0 {
                        head.push_str(&format!(" | ↑{}", compact(up)));
                    }
                }
                if kind.contains("queued_user") {
                    head.push_str(" | queued");
                }
                out.push(user_bar_line(
                    &format!(" {head}"),
                    theme.muted, // Ink headFg = t.muted
                    theme.user_bg,
                    theme.accent,
                    theme.muted, // screw
                    true,
                    true, // top screw ⨁ right-aligned
                    w,
                ));
                let body_w = w.saturating_sub(2); // │ + content
                let body_lines: Vec<String> = m
                    .content
                    .split('\n')
                    .flat_map(|p| wrap_str(p, body_w.saturating_sub(1)))
                    .collect();
                let limit = 10;
                let expanded = kind.contains("expanded");
                let total = body_lines.len();
                let show = if !expanded && total > limit {
                    &body_lines[..limit]
                } else {
                    &body_lines[..]
                };
                for chunk in show {
                    out.push(user_bar_line(
                        &format!(" {chunk}"),
                        theme.user,
                        theme.user_bg,
                        theme.accent,
                        theme.muted,
                        false,
                        false,
                        w,
                    ));
                }
                if total > limit {
                    hits.expands.push(ExpandHit {
                        line_idx: out.len(),
                        message_id: m.id.clone(),
                    });
                    // Ink: expand vs collapse affordance
                    let fold = if expanded {
                        format!(" ▲ 收起全文（{total} 行 · 点击）")
                    } else {
                        format!(" ▼ 展开全文（{total} 行 · 点击）")
                    };
                    out.push(user_bar_line(
                        &fold,
                        theme.dim,
                        theme.user_bg,
                        theme.accent,
                        theme.muted,
                        false,
                        false,
                        w,
                    ));
                }
                // bottom pad with right-aligned ⨁
                out.push(user_bar_line(
                    " ",
                    theme.user,
                    theme.user_bg,
                    theme.accent,
                    theme.muted,
                    false,
                    true,
                    w,
                ));
                out.push(Line::from(""));
            }
            "assistant" => {
                // Ink: ◈ ↺N | agent:coding | HH:MM:SS | (dur) | ↓tok · LIVE
                let logo = if m.streaming {
                    spinner_char(spinner_frame)
                } else {
                    "◈"
                };
                let mut head = String::new();
                if let Some(r) = m.round {
                    if r > 0 {
                        head.push_str(&loop_mark(r));
                        head.push_str(" | ");
                    }
                }
                head.push_str(&label);
                head.push_str(" | ");
                head.push_str(&tc);
                let dur = duration_str(m.duration_ms);
                if !dur.is_empty() {
                    head.push_str(&format!(" | ({dur})"));
                }
                if let Some(dn) = m.usage_output {
                    if dn > 0 {
                        head.push_str(&format!(" | ↓{}", compact(dn)));
                    }
                }
                let head_color = if m.streaming {
                    theme.accent
                } else {
                    theme.dim
                };
                if m.streaming {
                    // Ink LiveBadge: accent bold LIVE suffix
                    let mut spans = head_line(logo, &head, head_color, true).spans;
                    spans.push(Span::styled(
                        " · ".to_string(),
                        Style::default().fg(theme.dim),
                    ));
                    spans.push(Span::styled(
                        "LIVE".to_string(),
                        Style::default()
                            .fg(theme.accent)
                            .add_modifier(Modifier::BOLD | Modifier::SLOW_BLINK),
                    ));
                    out.push(Line::from(spans));
                } else {
                    out.push(head_line(logo, &head, head_color, true));
                }

                for th in &m.thinking_blocks {
                    let chars = th.content.chars().count();
                    // Ink ThinkingBlock: `* think (dur) // N 字 ▶` or streaming with spinner
                    let tlabel: String = if th.streaming {
                        format!(
                            "* think {} // {chars} 字",
                            spinner_char(spinner_frame)
                        )
                    } else {
                        let dur = duration_str(th.duration_ms);
                        let mark = if th.collapsed { "▶" } else { "▼" };
                        if dur.is_empty() {
                            format!("* think // {chars} 字 {mark}")
                        } else {
                            format!("* think ({dur}) // {chars} 字 {mark}")
                        }
                    };
                    // clickable header → ThinkingToggle (only when non-streaming)
                    if !th.streaming && !th.id.is_empty() {
                        hits.thinking.push(ThinkingHit {
                            line_idx: out.len(),
                            thinking_id: th.id.clone(),
                        });
                    }
                    out.push(pipe_body(&tlabel, theme.muted, theme));
                    if !th.collapsed || th.streaming {
                        let body = if th.collapsed && !th.streaming {
                            let t: String = th.content.chars().take(100).collect();
                            format!("{t}…")
                        } else {
                            // Ink: max 5 lines for think body
                            let lines: Vec<&str> = th.content.lines().collect();
                            if lines.len() > 5 {
                                if th.streaming {
                                    format!("…\n{}", lines[lines.len() - 5..].join("\n"))
                                } else {
                                    format!("{}\n…", lines[..5].join("\n"))
                                }
                            } else {
                                th.content.clone()
                            }
                        };
                        for chunk in wrap_str(&body, w.saturating_sub(LOGO_W + 4)) {
                            out.push(pipe_body(&format!("  {chunk}"), theme.dim, theme));
                        }
                    }
                }

                // Ink MdPaper-ish: assistant content with left │ gutter
                let content_trim = m.content.trim();
                if !content_trim.is_empty() || m.streaming {
                    let md = render_markdown(
                        if content_trim.is_empty() && m.streaming {
                            " "
                        } else {
                            &m.content
                        },
                        w.saturating_sub(LOGO_W + 2),
                        theme,
                        false,
                    );
                    let mut md_lines: Vec<Line<'static>> = Vec::new();
                    for line in md {
                        let plain: String =
                            line.spans.iter().map(|s| s.content.as_ref()).collect();
                        let text = plain.strip_prefix("  ").unwrap_or(&plain);
                        if text.chars().all(|c| c == '─' || c == ' ' || c == '-')
                            && text.contains('─')
                        {
                            md_lines.push(pipe_body(
                                &"─".repeat((w.saturating_sub(LOGO_W + 2)).min(80)),
                                theme.dim,
                                theme,
                            ));
                        } else {
                            md_lines.push(pipe_body(text, theme.assistant, theme));
                        }
                    }
                    if m.streaming {
                        // trailing spinner cursor
                        let spin = spinner_char(spinner_frame);
                        if let Some(last) = md_lines.last_mut() {
                            last.spans.push(Span::styled(
                                format!(" {spin}"),
                                Style::default()
                                    .fg(theme.accent)
                                    .add_modifier(Modifier::BOLD),
                            ));
                        } else {
                            md_lines.push(pipe_body(
                                &format!(" {spin}"),
                                theme.accent,
                                theme,
                            ));
                        }
                    }
                    let limit = 12;
                    let expanded = m
                        .kind
                        .as_ref()
                        .map(|k| k.contains("expanded"))
                        .unwrap_or(false);
                    let total = md_lines.len();
                    if !m.streaming && total > limit {
                        if expanded {
                            out.extend(md_lines);
                        } else {
                            out.extend(md_lines.into_iter().take(limit));
                        }
                        hits.expands.push(ExpandHit {
                            line_idx: out.len(),
                            message_id: m.id.clone(),
                        });
                        // Ink expand / collapse affordance
                        let fold = if expanded {
                            format!("▲ 收起全文（{total} 行 · 点击）")
                        } else {
                            format!("▼ 展开全文（已折叠约 {total} 行 · 点击展开）")
                        };
                        out.push(pipe_body(&fold, theme.dim, theme));
                    } else {
                        out.extend(md_lines);
                    }
                }

                for t in &m.tool_cards {
                    render_tool_card(
                        &mut out,
                        &mut hits,
                        m,
                        t,
                        w,
                        theme,
                        spinner_frame,
                        expanded_tool_results,
                    );
                }
                if m.tool_cards.is_empty() {
                    for name in &m.tools {
                        out.push(tool_title_line(name, "", "▶", false, theme));
                    }
                }
                out.push(Line::from(""));
            }
            "system" => {
                let sid = short_id(&m.id);
                out.push(head_line(
                    "▣",
                    &format!("{sid} | {label} | {tc}"),
                    theme.system,
                    false,
                ));
                for chunk in wrap_str(&m.content, w.saturating_sub(LOGO_W + 1)) {
                    out.push(body_line(&chunk, Style::default().fg(theme.system)));
                }
                out.push(Line::from(""));
            }
            _ => {
                out.push(head_line("·", &label, theme.fg, false));
                for chunk in wrap_str(&m.content, w.saturating_sub(LOGO_W + 1)) {
                    out.push(body_line(&chunk, Style::default().fg(theme.fg)));
                }
                out.push(Line::from(""));
            }
        }
    }

    (out, hits)
}

/// User bubble row: │ + text + optional right-aligned ⨁ (Ink UserBubble).
/// `width` is full chat inner width; bar takes 1 col, screw takes ~2.
fn user_bar_line(
    text: &str,
    fg: Color,
    bg: Color,
    bar: Color,
    screw_fg: Color,
    bold: bool,
    screw: bool,
    width: usize,
) -> Line<'static> {
    let mut st = Style::default().fg(fg).bg(bg);
    if bold {
        st = st.add_modifier(Modifier::BOLD);
    }
    let bar_w = 1usize;
    let screw_s = "⨁";
    let screw_w = if screw {
        UnicodeWidthStr::width(screw_s) + 1 // leading space before screw on head only varies
    } else {
        0
    };
    // Ink: inset 1 on head/bot for screw; body fills inner
    let inner_w = width.saturating_sub(bar_w).max(1);
    let text_budget = if screw {
        inner_w.saturating_sub(screw_w).saturating_sub(1) // trailing pad
    } else {
        inner_w
    };
    // pad text to budget so ⨁ sits on the right edge
    let mut core = text.to_string();
    let tw = UnicodeWidthStr::width(core.as_str());
    if tw > text_budget {
        core = trunc(&core, text_budget);
    } else if tw < text_budget {
        core.push_str(&" ".repeat(text_budget - tw));
    }
    let mut spans = vec![
        Span::styled("│".to_string(), Style::default().fg(bar).bg(bg)),
        Span::styled(core, st),
    ];
    if screw {
        spans.push(Span::styled(
            screw_s.to_string(),
            Style::default().fg(screw_fg).bg(bg),
        ));
        // trailing 1-col inset
        spans.push(Span::styled(
            " ".to_string(),
            Style::default().fg(bg).bg(bg),
        ));
    }
    Line::from(spans)
}

/// Assistant body: logo empty + │ + text (Ink MdPaper gutter)
fn pipe_body(text: &str, fg: Color, theme: &Theme) -> Line<'static> {
    Line::from(vec![
        Span::raw(logo_empty()),
        Span::styled("│ ".to_string(), Style::default().fg(theme.dim)),
        Span::styled(text.to_string(), Style::default().fg(fg)),
    ])
}

fn render_tool_card(
    out: &mut Vec<Line<'static>>,
    hits: &mut RenderHits,
    m: &UiMessage,
    t: &ProtoToolCard,
    w: usize,
    theme: &Theme,
    spinner_frame: u64,
    expanded_tool_results: &std::collections::HashSet<String>,
) {
    let (reason, target, pretty) = parse_args(&t.args);
    let mark = if !t.done {
        spinner_char(spinner_frame)
    } else if t.is_error {
        "✗"
    } else if t.expanded {
        "▼"
    } else {
        "▶"
    };
    let mut meta = target.clone();
    if !reason.is_empty() {
        if !meta.is_empty() {
            meta.push(' ');
        }
        meta.push_str(&trunc(&reason, 40));
    }
    let dur = duration_str(t.duration_ms);
    if !dur.is_empty() {
        meta.push_str(&format!(" ({dur})"));
    }

    hits.tools.push(ToolHit {
        line_idx: out.len(),
        message_id: m.id.clone(),
        tool_id: t.id.clone(),
    });
    // Ink: logo empty + " name " yellow + " target ▶"
    out.push(tool_title_line(&t.name, &meta, mark, t.is_error, theme));

    if t.expanded {
        if !pretty.is_empty() && pretty != "{}" && pretty != "{\n}" {
            out.push(pipe_body("▸ 输入", theme.dim, theme));
            let show: String = pretty.lines().take(6).collect::<Vec<_>>().join("\n");
            for chunk in wrap_str(&show, w.saturating_sub(LOGO_W + 4)) {
                out.push(pipe_body(&chunk, theme.warn, theme));
            }
        }
        if let Some(res) = &t.result {
            let label = if t.is_error {
                "▸ 输出（失败）"
            } else {
                "▸ 输出"
            };
            out.push(pipe_body(label, theme.dim, theme));
            // Ink ResultSection: toolResult (cyan) / err
            let color = if t.is_error {
                theme.err
            } else {
                theme.tool_result
            };
            let lines: Vec<&str> = res.lines().collect();
            let need_fold = lines.len() > 12;
            let full = expanded_tool_results.contains(&t.id);
            // Ink DiffCollapsible: collapsed preview 8 lines; open = full + ▲ 收起
            let preview_n = if is_diff_result(res) || is_write_tool(&t.name) {
                8
            } else {
                12
            };
            let show: String = if need_fold && !full {
                lines[..preview_n.min(lines.len())].join("\n")
            } else {
                res.clone()
            };
            if is_diff_result(res) || is_write_tool(&t.name) {
                for raw in show.split('\n') {
                    let st = if raw.starts_with('+') && !raw.starts_with("+++") {
                        theme.diff_add
                    } else if raw.starts_with('-') && !raw.starts_with("---") {
                        theme.diff_del
                    } else {
                        color
                    };
                    for chunk in wrap_str(raw, w.saturating_sub(LOGO_W + 4)) {
                        out.push(pipe_body(&chunk, st, theme));
                    }
                }
            } else {
                for chunk in wrap_str(&show, w.saturating_sub(LOGO_W + 4)) {
                    out.push(pipe_body(&chunk, color, theme));
                }
            }
            if need_fold {
                hits.tool_results.push(ToolResultHit {
                    line_idx: out.len(),
                    tool_id: t.id.clone(),
                });
                let fold = if full {
                    "▲ 收起 diff".to_string()
                } else if is_diff_result(res) || is_write_tool(&t.name) {
                    format!("▼ 展开完整 diff（{} 行 · 点击展开）", lines.len())
                } else {
                    format!("▼ 展开完整输出（{} 行 · 点击）", lines.len())
                };
                out.push(pipe_body(&fold, theme.dim, theme));
            }
        }
    }
}

fn tool_title_line(
    name: &str,
    meta: &str,
    mark: &str,
    is_error: bool,
    theme: &Theme,
) -> Line<'static> {
    let name_style = Style::default()
        .fg(Color::Black)
        .bg(if is_error { theme.err } else { theme.tool })
        .add_modifier(Modifier::BOLD);
    let mut spans = vec![
        Span::raw(logo_empty()),
        Span::styled(format!(" {name} "), name_style),
    ];
    if !meta.is_empty() {
        spans.push(Span::styled(
            format!(" {meta} "),
            Style::default().fg(theme.dim),
        ));
    }
    spans.push(Span::styled(
        format!(" {mark}"),
        Style::default().fg(theme.muted),
    ));
    Line::from(spans)
}

fn head_line(logo: &str, text: &str, color: Color, bold: bool) -> Line<'static> {
    let mut st = Style::default().fg(color);
    if bold {
        st = st.add_modifier(Modifier::BOLD);
    }
    Line::from(vec![
        Span::styled(pad_logo(logo), st),
        Span::styled(text.to_string(), st),
    ])
}

fn body_line(text: &str, style: Style) -> Line<'static> {
    Line::from(vec![
        Span::raw(logo_empty()),
        Span::styled(text.to_string(), style),
    ])
}

fn spinner_char(frame: u64) -> &'static str {
    const FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    FRAMES[(frame as usize / 2) % FRAMES.len()]
}

fn trunc(s: &str, w: usize) -> String {
    if UnicodeWidthStr::width(s) <= w {
        return s.to_string();
    }
    let mut out = String::new();
    let mut used = 0;
    for ch in s.chars() {
        let cw = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1);
        if used + cw > w.saturating_sub(1) {
            break;
        }
        out.push(ch);
        used += cw;
    }
    out.push('…');
    out
}

/// EventBlock: Ink dump style
/// `◤○ IDLE  ↑~57.2k …… NORMAL · 询问 …… 0↑ 0↓ ◥`
pub fn render_event_block(
    width: u16,
    theme: &Theme,
    mode: &str,
    aborting: bool,
    approval_mode: &str,
    up: u64,
    down: u64,
    detail: &str,
    pending: u32,
) -> Line<'static> {
    render_event_block_framed(width, theme, mode, aborting, approval_mode, up, down, detail, pending, 0)
}

/// Same as `render_event_block` with spinner frame for busy modes (Ink useAnimFrame).
pub fn render_event_block_framed(
    width: u16,
    theme: &Theme,
    mode: &str,
    aborting: bool,
    approval_mode: &str,
    up: u64,
    down: u64,
    detail: &str,
    pending: u32,
    spinner_frame: u64,
) -> Line<'static> {
    let (icon, en, color) = short_status(mode, aborting, detail, theme);
    // Ink: busy modes replace static icon with braille spinner
    let icon = if !aborting && matches!(mode, "thinking" | "generating" | "tool_pending" | "retrying")
    {
        spinner_char(spinner_frame)
    } else {
        icon
    };
    // Ink approvalStyle: NORMAL uses inputFieldBg (#B0B0B0); AUTO warn; YOLO err
    let (appr_bg, appr_title, appr_hint) = match approval_mode {
        "auto" => (theme.warn, "AUTO", "自动"),
        "yolo" => (theme.err, "YOLO", "全放"),
        _ => (theme.input_field_bg, "NORMAL", "询问"),
    };

    // compact up like Ink ↑~57.2k when large
    let up_s = if up >= 1000 {
        format!("↑~{}", compact(up))
    } else {
        format!("↑{up}")
    };
    // Ink dump: ◤○ IDLE  ↑~57.2k …… NORMAL · 询问 …… 0↑ 0↓ ◥
    let left = format!("{icon} {en}  {up_s}");
    let mid = format!(" {appr_title} · {appr_hint} ");
    let right = format!("{up}↑ {down}↓");
    let pend = if pending > 0 {
        format!(" q{pending} ")
    } else {
        String::new()
    };

    let used = UnicodeWidthStr::width(left.as_str())
        + UnicodeWidthStr::width(mid.as_str())
        + UnicodeWidthStr::width(right.as_str())
        + UnicodeWidthStr::width(pend.as_str())
        + 2; // corners
    let pad = (width as usize).saturating_sub(used);
    // Ink-ish: left cluster · mid chip · right tokens; gaps fill exact width
    // Prefer slightly larger right gap so mid sits optically left-of-center (Ink pad/3)
    let gap_l_n = if pad <= 1 {
        0
    } else if pad == 2 {
        1
    } else {
        (pad / 3).max(1)
    };
    let gap_r_n = pad.saturating_sub(gap_l_n);
    let gap_l = " ".repeat(gap_l_n);
    let gap_r = " ".repeat(gap_r_n);

    Line::from(vec![
        Span::styled("◤", Style::default().fg(theme.bg).bg(theme.footer_bg)),
        Span::styled(left, Style::default().fg(color).bg(theme.footer_bg)),
        Span::styled(gap_l, Style::default().bg(theme.footer_bg)),
        Span::styled(
            mid,
            Style::default()
                .fg(Color::Black)
                .bg(appr_bg)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(pend, Style::default().fg(theme.accent).bg(theme.footer_bg)),
        Span::styled(gap_r, Style::default().bg(theme.footer_bg)),
        Span::styled(
            right,
            Style::default().fg(Color::Black).bg(theme.footer_bg),
        ),
        Span::styled("◥", Style::default().fg(theme.bg).bg(theme.footer_bg)),
    ])
}

fn short_status(
    mode: &str,
    aborting: bool,
    detail: &str,
    theme: &Theme,
) -> (&'static str, String, Color) {
    if aborting {
        return ("✕", "ABORT".into(), theme.err);
    }
    match mode {
        "thinking" => ("◈", "THINK".into(), theme.accent),
        "generating" => ("◆", "GEN".into(), theme.accent),
        "tool_pending" => {
            let en = if detail.is_empty() {
                "TOOL".into()
            } else {
                format!("TOOL {}", trunc(detail, 12))
            };
            ("▣", en, theme.accent2)
        }
        "retrying" => ("↻", "RETRY".into(), theme.warn),
        "error" => ("✕", "ERR".into(), theme.err),
        _ => ("○", "IDLE".into(), theme.dim),
    }
}

/// SelectList row: pointer + label
pub fn select_row(label: &str, desc: &str, selected: bool, theme: &Theme) -> Line<'static> {
    let pointer = if selected { "❯ " } else { "  " };
    let text = if desc.is_empty() {
        label.to_string()
    } else {
        format!("{label}  {desc}")
    };
    let style = if selected {
        Style::default()
            .fg(theme.accent)
            .bg(theme.selected_bg)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(theme.fg)
    };
    Line::from(Span::styled(format!("{pointer}{text}"), style))
}

/// Flatten a Line to plain text (for tests / line cache).
pub fn line_plain(line: &Line<'_>) -> String {
    line.spans.iter().map(|s| s.content.as_ref()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ProtoToolCard, UiMessage};
    use crate::theme::Theme;

    fn fixture_messages() -> Vec<UiMessage> {
        vec![
            UiMessage {
                id: "u1".into(),
                role: "user".into(),
                content: "hello world".into(),
                ts: Some(1_700_000_000_000),
                streaming: false,
                tools: vec![],
                tool_cards: vec![],
                thinking_blocks: vec![],
                duration_ms: None,
                round: Some(1),
                kind: None,
                author_label: Some("user".into()),
                usage_input: Some(12),
                usage_output: None,
            },
            UiMessage {
                id: "a1".into(),
                role: "assistant".into(),
                content: "reply line\n\n## Heading\nmore".into(),
                ts: Some(1_700_000_100_000),
                streaming: false,
                tools: vec![],
                tool_cards: vec![ProtoToolCard {
                    id: "t1".into(),
                    name: "reader".into(),
                    args: r#"{"path":"client/src/config.ts","reason":"先读文件"}"#.into(),
                    result: Some("ok".into()),
                    is_error: false,
                    done: true,
                    duration_ms: Some(12),
                    expanded: false,
                }],
                thinking_blocks: vec![],
                duration_ms: Some(800),
                round: Some(1),
                kind: None,
                author_label: Some("agent:coding".into()),
                usage_input: None,
                usage_output: Some(48),
            },
        ]
    }

    #[test]
    fn compact_formats_like_ink() {
        assert_eq!(compact(0), "0");
        assert_eq!(compact(999), "999");
        assert_eq!(compact(200_000), "200.0k");
        assert_eq!(compact(1_500_000), "1.5M");
    }

    #[test]
    fn duration_and_short_id_match_ink() {
        assert_eq!(duration_str(Some(350)), "350ms");
        assert_eq!(duration_str(Some(1200)), "1.2s");
        assert_eq!(duration_str(Some(150_000)), "2.5min");
        assert_eq!(short_id("muabc123xyz"), "abc123");
        assert_eq!(short_id("msg01"), "sg01");
        assert_eq!(loop_mark(3), "↺3");
    }

    #[test]
    fn event_block_has_corners_and_approval_chip() {
        let theme = Theme::default();
        let line = render_event_block(80, &theme, "idle", false, "normal", 57200, 120, "", 0);
        let plain = line_plain(&line);
        assert!(plain.contains('◤') && plain.contains('◥'), "corners: {plain}");
        assert!(plain.contains("IDLE"), "idle: {plain}");
        assert!(plain.contains("NORMAL") && plain.contains("询问"), "approval: {plain}");
        assert!(plain.contains('↑') && plain.contains('↓'), "tokens: {plain}");
    }

    #[test]
    fn system_event_banner_matches_ink_shape() {
        let theme = Theme::default();
        let line = render_system_event_line(
            "compress",
            "context compacted",
            Some(1_700_000_000_000),
            60,
            &theme,
        );
        let plain = line_plain(&line);
        assert!(plain.contains('>') && plain.contains('<'), "pad: {plain}");
        assert!(plain.contains('[') && plain.contains(']'), "bracket: {plain}");
        assert!(
            plain.contains("context compacted") || plain.contains("compact"),
            "content: {plain}"
        );
        assert_eq!(system_event_symbol("abort"), "✕");
        assert_eq!(system_event_symbol("system_notice"), "📋");
    }

    #[test]
    fn system_event_detail_collapsed_until_expanded() {
        use crate::protocol::ProtoSystemEvent;
        let theme = Theme::default();
        let ev = ProtoSystemEvent {
            id: "se1".into(),
            kind: "compress".into(),
            content: "compacted".into(),
            ts: Some(1),
            detail: Some("line1\nline2\nline3".into()),
        };
        let empty = std::collections::HashSet::new();
        let empty_tr = std::collections::HashSet::new();
        let (lines, hits) =
            render_messages(&[], &[ev.clone()], 80, &theme, 200, 0, &empty, &empty_tr);
        let joined: String = lines.iter().map(line_plain).collect::<Vec<_>>().join("\n");
        assert!(joined.contains("▶ 详情"), "collapsed affordance: {joined}");
        assert!(!joined.contains("line1"), "detail hidden when collapsed");
        assert!(!hits.system_events.is_empty());

        let mut open = std::collections::HashSet::new();
        open.insert("se1".into());
        let (lines2, _) =
            render_messages(&[], &[ev], 80, &theme, 200, 0, &open, &empty_tr);
        let joined2: String = lines2.iter().map(line_plain).collect::<Vec<_>>().join("\n");
        assert!(joined2.contains("line1"), "detail shown when open: {joined2}");
        assert!(!joined2.contains("▶ 详情"), "no affordance when open");
    }

    #[test]
    fn tool_result_fold_registers_hit_when_long() {
        use crate::protocol::ProtoToolCard;
        let theme = Theme::default();
        let long = (0..20).map(|i| format!("line{i}")).collect::<Vec<_>>().join("\n");
        let mut msgs = fixture_messages();
        msgs[1].tool_cards = vec![ProtoToolCard {
            id: "tfold".into(),
            name: "bash".into(),
            args: "{}".into(),
            result: Some(long),
            is_error: false,
            done: true,
            duration_ms: Some(1),
            expanded: true,
        }];
        let empty = std::collections::HashSet::new();
        let empty_tr = std::collections::HashSet::new();
        let (lines, hits) =
            render_messages(&msgs, &[], 100, &theme, 200, 0, &empty, &empty_tr);
        assert!(!hits.tool_results.is_empty(), "fold hit");
        let plain = line_plain(&lines[hits.tool_results[0].line_idx]);
        assert!(plain.contains("展开") || plain.contains("▼"), "fold label: {plain}");

        let mut open = std::collections::HashSet::new();
        open.insert("tfold".into());
        let (lines2, hits2) =
            render_messages(&msgs, &[], 100, &theme, 200, 0, &empty, &open);
        let plain2 = line_plain(&lines2[hits2.tool_results[0].line_idx]);
        assert!(plain2.contains("收起"), "collapse: {plain2}");
    }

    #[test]
    fn thinking_header_registers_hit() {
        use crate::protocol::ProtoThinking;
        let theme = Theme::default();
        let mut msgs = fixture_messages();
        msgs[1].thinking_blocks = vec![ProtoThinking {
            id: "th1".into(),
            content: "reason step one".into(),
            streaming: false,
            duration_ms: Some(100),
            collapsed: true,
        }];
        let empty = std::collections::HashSet::new();
        let empty_tr = std::collections::HashSet::new();
        let (lines, hits) =
            render_messages(&msgs, &[], 100, &theme, 200, 0, &empty, &empty_tr);
        assert_eq!(hits.thinking.len(), 1);
        assert_eq!(hits.thinking[0].thinking_id, "th1");
        let plain = line_plain(&lines[hits.thinking[0].line_idx]);
        assert!(plain.contains("think"), "header: {plain}");
    }

    #[test]
    fn message_layout_markers_match_ink_chrome() {
        let theme = Theme::default();
        let empty_sys = std::collections::HashSet::new();
        let empty_tr = std::collections::HashSet::new();
        let (lines, hits) = render_messages(
            &fixture_messages(),
            &[],
            100,
            &theme,
            200,
            0,
            &empty_sys,
            &empty_tr,
        );
        let joined: String = lines.iter().map(line_plain).collect::<Vec<_>>().join("\n");

        // user bar + screw
        assert!(
            joined.contains('│') && joined.contains('⨁'),
            "user block must use │ bar and ⨁: {joined}"
        );
        assert!(
            joined.contains("user |") || joined.contains("user"),
            "user head present: {joined}"
        );

        // assistant head with ↺ / ◈ and agent label — no standalone loop band only
        assert!(
            joined.contains('◈') || joined.contains("↺"),
            "assistant head marker: {joined}"
        );
        assert!(
            !joined.contains("────────── ↺ loop"),
            "must not use separate loop-only band: {joined}"
        );
        assert!(
            joined.contains("agent:coding") || joined.contains("agent"),
            "agent label: {joined}"
        );

        // assistant body gutter
        assert!(
            joined.contains("│ "),
            "assistant body │ gutter: {joined}"
        );

        // tool yellow-name line marker
        assert!(
            joined.contains("reader") && (joined.contains('▶') || joined.contains('▼')),
            "tool line name + ▶: {joined}"
        );
        assert_eq!(hits.tools.len(), 1);
        assert_eq!(hits.tools[0].name_or_id_for_test(), "t1");
    }
}

// test helper on ToolHit
impl ToolHit {
    #[cfg(test)]
    fn name_or_id_for_test(&self) -> &str {
        &self.tool_id
    }
}
