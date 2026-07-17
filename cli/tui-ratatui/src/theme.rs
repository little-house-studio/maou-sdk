//! Theme tokens → ratatui Color (hex #rrggbb).
//! Defaults + ProtoTheme mirror Ink `ThemeTokens` / `assets/themes/tau-ceti.json`.

use crate::protocol::{ProtoNavItem, ProtoTheme};
use ratatui::style::Color;

/// 运行时 nav 段（主题 JSON 下发，非硬编码）
#[derive(Clone, Debug)]
pub struct NavSeg {
    pub id: String,
    pub label: String,
    pub short: String,
    pub bg: Color,
    pub bg_hover: Color,
    pub fg: Color,
    pub fg_hover: Color,
    pub action_kind: String,
    pub action_value: String,
}

#[derive(Clone, Debug)]
pub struct Theme {
    // general
    pub bg: Color,
    pub panel_bg: Color,
    pub fg: Color,
    pub dim: Color,
    pub muted: Color,
    // emphasis
    pub accent: Color,
    pub accent2: Color,
    // status
    pub ok: Color,
    pub warn: Color,
    pub err: Color,
    pub info: Color,
    // roles
    pub user: Color,
    pub assistant: Color,
    pub system: Color,
    pub tool: Color,
    pub tool_result: Color,
    // surfaces
    pub user_bg: Color,
    pub system_bg: Color,
    pub footer_bg: Color,
    /// Ink inputFieldBg — input field + NORMAL approval chip
    pub input_field_bg: Color,
    pub border: Color,
    pub selected_bg: Color,
    pub assistant_md_bg: Color,
    // markdown
    pub md_heading: Color,
    pub md_heading2: Color,
    pub md_heading3: Color,
    pub md_code: Color,
    pub md_code_block: Color,
    pub md_quote: Color,
    pub md_quote_border: Color,
    pub md_list: Color,
    pub md_link: Color,
    pub md_hr: Color,
    // diff
    pub diff_add: Color,
    pub diff_del: Color,
    pub diff_context: Color,
    // legacy per-id nav colors (fallback when nav_items empty)
    pub nav_agent: Color,
    pub nav_sessions: Color,
    pub nav_terminal: Color,
    pub nav_todo: Color,
    pub nav_inbox: Color,
    pub nav_notice: Color,
    pub nav_settings: Color,
    pub nav_agent_hover: Color,
    pub nav_sessions_hover: Color,
    pub nav_terminal_hover: Color,
    pub nav_todo_hover: Color,
    pub nav_inbox_hover: Color,
    pub nav_notice_hover: Color,
    pub nav_settings_hover: Color,
    /// 动态 nav 段（优先）
    pub nav_items: Vec<NavSeg>,
    /// Ink completion desc on computer-blue
    pub completion_desc: Color,
    pub completion_hint: Color,
    /// Placeholder on input field (darker gray on #B0B0B0)
    pub input_placeholder_fg: Color,
    /// Selection flash (sel-fx)
    pub sel_flash_bg: Color,
    pub sel_flash_fg: Color,
    pub sel_fg: Color,
    pub sel_bg: Color,
}

impl Default for Theme {
    fn default() -> Self {
        // Exact hex from assets/themes/tau-ceti.json (+ Ink sel-fx constants)
        Self {
            // 略抬亮底 + 暖灰（略泛黄，非中性灰）
            bg: hex(0x1A, 0x1A, 0x1A),
            panel_bg: hex(0x26, 0x24, 0x1F),
            fg: hex(0xC8, 0xC4, 0xB6),
            dim: hex(0x85, 0x80, 0x70),
            muted: hex(0x85, 0x80, 0x70),
            accent: hex(0xC7, 0xFF, 0x20),
            accent2: hex(0x3B, 0xFF, 0xA7),
            ok: hex(0x3B, 0xFF, 0xA7),
            warn: hex(0xFF, 0xD9, 0x00),
            err: hex(0xFF, 0x74, 0x1D),
            info: hex(0x21, 0x21, 0xFF),
            user: hex(0xFF, 0xFF, 0xFF),
            assistant: hex(0xC8, 0xC4, 0xB6),
            system: hex(0x83, 0x63, 0xFF),
            tool: hex(0xC7, 0xFF, 0x20),
            tool_result: hex(0x3B, 0xFF, 0xA7),
            user_bg: hex(0x26, 0x24, 0x1F),
            system_bg: hex(0x26, 0x24, 0x1F),
            footer_bg: hex(0xC8, 0xC4, 0xB6),
            input_field_bg: hex(0xB3, 0xAD, 0x9E),
            border: hex(0x26, 0x24, 0x1F),
            selected_bg: hex(0x26, 0x24, 0x1F),
            assistant_md_bg: hex(0x22, 0x20, 0x1A),
            md_heading: hex(0xC7, 0xFF, 0x20),
            md_heading2: hex(0x3B, 0xFF, 0xA7),
            md_heading3: hex(0xFF, 0xD9, 0x00),
            md_code: hex(0x3B, 0xFF, 0xA7),
            // 代码正文：冷中性灰（勿暖黄 #E0DCCC「屎黄」）
            md_code_block: hex(0xD4, 0xD4, 0xD4),
            md_quote: hex(0xA8, 0xA0, 0x90),
            md_quote_border: hex(0xC7, 0xFF, 0x20),
            md_list: hex(0xC7, 0xFF, 0x20),
            md_link: hex(0x7A, 0xA2, 0xF7),
            md_hr: hex(0x4A, 0x46, 0x3C),
            diff_add: hex(0x3B, 0xFF, 0xA7),
            diff_del: hex(0xFF, 0x74, 0x1D),
            diff_context: hex(0x85, 0x80, 0x70),
            nav_agent: hex(0xFF, 0x74, 0x1D),
            nav_sessions: hex(0xF5, 0xF0, 0xD8),
            nav_terminal: hex(0x4A, 0x47, 0x3F),
            nav_todo: hex(0x3A, 0x38, 0x30),
            nav_inbox: hex(0x2A, 0x28, 0x22),
            nav_notice: hex(0x1E, 0x1C, 0x18),
            nav_settings: hex(0xC7, 0xFF, 0x20),
            nav_agent_hover: hex(0xFF, 0x8A, 0x3D),
            nav_sessions_hover: hex(0xFF, 0xF8, 0xE0),
            nav_terminal_hover: hex(0x5A, 0x56, 0x4C),
            nav_todo_hover: hex(0x4A, 0x47, 0x3F),
            nav_inbox_hover: hex(0x35, 0x32, 0x2C),
            nav_notice_hover: hex(0x26, 0x24, 0x1F),
            nav_settings_hover: hex(0xD4, 0xFF, 0x4A),
            nav_items: Vec::new(),
            completion_desc: hex(0xA8, 0xA8, 0xFF),
            completion_hint: hex(0xC5, 0xC5, 0xFF),
            input_placeholder_fg: hex(0x40, 0x40, 0x40),
            sel_flash_bg: Color::Rgb(220, 220, 220),
            sel_flash_fg: Color::Rgb(20, 20, 20),
            // Ink SEL_FG_SGR ≈ #EBEBEB
            sel_fg: hex(0xEB, 0xEB, 0xEB),
            sel_bg: hex(0x21, 0x21, 0xFF),
        }
    }
}

fn hex(r: u8, g: u8, b: u8) -> Color {
    Color::Rgb(r, g, b)
}

pub fn parse_hex(s: &str) -> Option<Color> {
    let s = s.trim().trim_start_matches('#');
    let s = if s.len() >= 8 { &s[..6] } else { s };
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some(Color::Rgb(r, g, b))
}

/// Format Color as #RRGGBB for tests / dumps.
pub fn color_hex(c: Color) -> String {
    match c {
        Color::Rgb(r, g, b) => format!("#{r:02X}{g:02X}{b:02X}"),
        _ => format!("{c:?}"),
    }
}

impl Theme {
    pub fn apply(&mut self, t: &ProtoTheme) {
        macro_rules! set {
            ($field:ident, $proto:expr) => {
                if let Some(c) = $proto.as_deref().and_then(parse_hex) {
                    self.$field = c;
                }
            };
        }
        set!(bg, t.bg);
        set!(panel_bg, t.panel_bg);
        set!(fg, t.fg);
        set!(dim, t.dim);
        set!(muted, t.muted);
        set!(accent, t.accent);
        set!(accent2, t.accent2);
        set!(ok, t.ok);
        set!(warn, t.warn);
        set!(err, t.err);
        set!(info, t.info);
        set!(user, t.user);
        set!(assistant, t.assistant);
        set!(system, t.system);
        set!(tool, t.tool);
        set!(tool_result, t.tool_result);
        set!(user_bg, t.user_bg);
        set!(system_bg, t.system_bg);
        set!(footer_bg, t.footer_bg);
        set!(input_field_bg, t.input_field_bg);
        set!(border, t.border);
        set!(selected_bg, t.selected_bg);
        set!(assistant_md_bg, t.assistant_md_bg);
        set!(md_heading, t.md_heading);
        set!(md_heading2, t.md_heading2);
        set!(md_heading3, t.md_heading3);
        set!(md_code, t.md_code);
        set!(md_code_block, t.md_code_block);
        set!(md_quote, t.md_quote);
        set!(md_quote_border, t.md_quote_border);
        set!(md_list, t.md_list_bullet);
        set!(md_link, t.md_link);
        set!(md_hr, t.md_hr);
        set!(diff_add, t.tool_diff_added);
        set!(diff_del, t.tool_diff_removed);
        set!(diff_context, t.tool_diff_context);
        set!(nav_agent, t.nav_agent);
        set!(nav_sessions, t.nav_sessions);
        set!(nav_terminal, t.nav_terminal);
        set!(nav_todo, t.nav_todo);
        set!(nav_inbox, t.nav_inbox);
        set!(nav_notice, t.nav_notice);
        set!(nav_settings, t.nav_settings);
        set!(nav_agent_hover, t.nav_agent_hover);
        set!(nav_sessions_hover, t.nav_sessions_hover);
        set!(nav_terminal_hover, t.nav_terminal_hover);
        set!(nav_todo_hover, t.nav_todo_hover);
        set!(nav_inbox_hover, t.nav_inbox_hover);
        set!(nav_notice_hover, t.nav_notice_hover);
        set!(nav_settings_hover, t.nav_settings_hover);
        set!(sel_bg, t.sel_bg);
        set!(sel_fg, t.sel_fg);

        if let Some(items) = &t.nav_items {
            if !items.is_empty() {
                self.nav_items = items
                    .iter()
                    .map(|it| nav_seg_from_proto(it, self))
                    .collect();
            }
        }
    }

    /// 绘制用：有 nav_items 用动态，否则 legacy 7 段
    pub fn nav_segs_for_draw(&self) -> Vec<NavSeg> {
        if !self.nav_items.is_empty() {
            return self.nav_items.clone();
        }
        legacy_nav_segs(self)
    }
}

fn nav_seg_from_proto(it: &ProtoNavItem, th: &Theme) -> NavSeg {
    let fallback = |id: &str| -> (Color, Color, Color, Color) {
        match id {
            "agent" => (th.nav_agent, th.nav_agent_hover, Color::Black, Color::Black),
            "sessions" => (
                th.nav_sessions,
                th.nav_sessions_hover,
                Color::Black,
                Color::Black,
            ),
            "terminal" => (
                th.nav_terminal,
                th.nav_terminal_hover,
                Color::White,
                Color::White,
            ),
            "todo" => (th.nav_todo, th.nav_todo_hover, Color::White, Color::White),
            "inbox" => (th.nav_inbox, th.nav_inbox_hover, Color::White, Color::White),
            "notice" => (
                th.nav_notice,
                th.nav_notice_hover,
                Color::White,
                Color::White,
            ),
            "settings" => (
                th.nav_settings,
                th.nav_settings_hover,
                Color::Black,
                Color::Black,
            ),
            _ => (th.panel_bg, th.selected_bg, th.fg, th.fg),
        }
    };
    let (fbg, fhover, ffg, ffgh) = fallback(&it.id);
    NavSeg {
        id: it.id.clone(),
        label: if it.label.is_empty() {
            it.id.clone()
        } else {
            it.label.clone()
        },
        short: if it.short.is_empty() {
            it.id.clone()
        } else {
            it.short.clone()
        },
        bg: it.bg.as_deref().and_then(parse_hex).unwrap_or(fbg),
        bg_hover: it
            .bg_hover
            .as_deref()
            .and_then(parse_hex)
            .unwrap_or(fhover),
        fg: it.fg.as_deref().and_then(parse_hex).unwrap_or(ffg),
        fg_hover: it
            .fg_hover
            .as_deref()
            .and_then(parse_hex)
            .unwrap_or(ffgh),
        action_kind: it
            .action_kind
            .clone()
            .unwrap_or_else(|| "noop".into()),
        action_value: it.action_value.clone().unwrap_or_default(),
    }
}

fn legacy_nav_segs(th: &Theme) -> Vec<NavSeg> {
    // 仅协议未带 nav_items 时的兜底
    [
        ("agent", "agent", "ag", th.nav_agent, th.nav_agent_hover, false),
        (
            "sessions",
            "会话",
            "会话",
            th.nav_sessions,
            th.nav_sessions_hover,
            false,
        ),
        (
            "terminal",
            "终端",
            "终端",
            th.nav_terminal,
            th.nav_terminal_hover,
            true,
        ),
        ("todo", "任务", "任务", th.nav_todo, th.nav_todo_hover, true),
        (
            "inbox",
            "收件箱",
            "收件",
            th.nav_inbox,
            th.nav_inbox_hover,
            true,
        ),
        (
            "notice",
            "公告",
            "公告",
            th.nav_notice,
            th.nav_notice_hover,
            true,
        ),
        (
            "settings",
            "设置",
            "设置",
            th.nav_settings,
            th.nav_settings_hover,
            false,
        ),
    ]
    .into_iter()
    .map(|(id, label, short, bg, bg_hover, dark)| {
        let (kind, val) = match id {
            "agent" => ("hotkey", "open_agents"),
            "sessions" => ("command", "sessions"),
            "settings" => ("command", "settings"),
            "terminal" | "todo" => ("hotkey", "ctrl+k"),
            "inbox" => ("toast", "收件箱 · 暂未接入"),
            "notice" => ("toast", "公告 · 暂未接入"),
            _ => ("noop", ""),
        };
        let fg = if dark { Color::White } else { Color::Black };
        NavSeg {
            id: id.into(),
            label: label.into(),
            short: short.into(),
            bg,
            bg_hover,
            fg,
            fg_hover: fg,
            action_kind: kind.into(),
            action_value: val.into(),
        }
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_theme_matches_tau_ceti_hex() {
        let t = Theme::default();
        assert_eq!(color_hex(t.bg), "#1A1A1A");
        assert_eq!(color_hex(t.fg), "#C8C4B6");
        assert_eq!(color_hex(t.muted), "#858070");
        assert_eq!(color_hex(t.accent), "#C7FF20");
        assert_eq!(color_hex(t.accent2), "#3BFFA7");
        assert_eq!(color_hex(t.warn), "#FFD900");
        assert_eq!(color_hex(t.err), "#FF741D");
        assert_eq!(color_hex(t.info), "#2121FF");
        assert_eq!(color_hex(t.user), "#FFFFFF");
        assert_eq!(color_hex(t.assistant), "#C8C4B6");
        assert_eq!(color_hex(t.system), "#8363FF");
        assert_eq!(color_hex(t.tool), "#C7FF20");
        assert_eq!(color_hex(t.tool_result), "#3BFFA7");
        assert_eq!(color_hex(t.user_bg), "#26241F");
        assert_eq!(color_hex(t.footer_bg), "#C8C4B6");
        assert_eq!(color_hex(t.input_field_bg), "#B3AD9E");
        assert_eq!(color_hex(t.border), "#26241F");
        assert_eq!(color_hex(t.md_heading2), "#3BFFA7");
        assert_eq!(color_hex(t.md_heading3), "#FFD900");
        assert_eq!(color_hex(t.md_link), "#7AA2F7");
        assert_eq!(color_hex(t.nav_agent), "#FF741D");
        assert_eq!(color_hex(t.nav_sessions), "#F5F0D8");
        assert_eq!(color_hex(t.nav_settings), "#C7FF20");
        assert_eq!(color_hex(t.sel_bg), "#2121FF");
        assert_eq!(color_hex(t.sel_fg), "#EBEBEB");
    }

    #[test]
    fn apply_proto_overrides_tokens() {
        let mut t = Theme::default();
        let p = ProtoTheme {
            accent: Some("#112233".into()),
            tool_result: Some("#AABBCC".into()),
            nav_agent: Some("#010203".into()),
            ..Default::default()
        };
        t.apply(&p);
        assert_eq!(color_hex(t.accent), "#112233");
        assert_eq!(color_hex(t.tool_result), "#AABBCC");
        assert_eq!(color_hex(t.nav_agent), "#010203");
        // untouched stay tau-ceti
        assert_eq!(color_hex(t.bg), "#1A1A1A");
    }
}
