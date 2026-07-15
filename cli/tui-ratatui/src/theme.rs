//! Theme tokens → ratatui Color (hex #rrggbb).
//! Defaults + ProtoTheme mirror Ink `ThemeTokens` / `assets/themes/tau-ceti.json`.

use crate::protocol::ProtoTheme;
use ratatui::style::Color;

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
    // nav (tau-ceti order)
    pub nav_agent: Color,
    pub nav_sessions: Color,
    pub nav_terminal: Color,
    pub nav_todo: Color,
    pub nav_inbox: Color,
    pub nav_notice: Color,
    pub nav_settings: Color,
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
            bg: hex(0x10, 0x10, 0x10),
            panel_bg: hex(0x24, 0x24, 0x24),
            fg: hex(0xC5, 0xC5, 0xC5),
            dim: hex(0x80, 0x80, 0x80),
            muted: hex(0x80, 0x80, 0x80),
            accent: hex(0xC7, 0xFF, 0x20),
            accent2: hex(0x3B, 0xFF, 0xA7),
            ok: hex(0x3B, 0xFF, 0xA7),
            warn: hex(0xFF, 0xD9, 0x00),
            err: hex(0xFF, 0x74, 0x1D),
            info: hex(0x21, 0x21, 0xFF),
            user: hex(0xFF, 0xFF, 0xFF),
            assistant: hex(0xC5, 0xC5, 0xC5),
            system: hex(0x83, 0x63, 0xFF),
            tool: hex(0xC7, 0xFF, 0x20),
            tool_result: hex(0x3B, 0xFF, 0xA7),
            user_bg: hex(0x24, 0x24, 0x24),
            system_bg: hex(0x24, 0x24, 0x24),
            footer_bg: hex(0xC5, 0xC5, 0xC5),
            input_field_bg: hex(0xB0, 0xB0, 0xB0),
            border: hex(0x24, 0x24, 0x24),
            selected_bg: hex(0x24, 0x24, 0x24),
            assistant_md_bg: hex(0x1A, 0x1A, 0x1A),
            md_heading: hex(0xC7, 0xFF, 0x20),
            md_heading2: hex(0x3B, 0xFF, 0xA7),
            md_heading3: hex(0xFF, 0xD9, 0x00),
            md_code: hex(0x3B, 0xFF, 0xA7),
            md_code_block: hex(0xC5, 0xC5, 0xC5),
            md_quote: hex(0x80, 0x80, 0x80),
            md_quote_border: hex(0xC7, 0xFF, 0x20),
            md_list: hex(0xC7, 0xFF, 0x20),
            md_link: hex(0x21, 0x21, 0xFF),
            md_hr: hex(0x24, 0x24, 0x24),
            diff_add: hex(0x3B, 0xFF, 0xA7),
            diff_del: hex(0xFF, 0x74, 0x1D),
            diff_context: hex(0x80, 0x80, 0x80),
            nav_agent: hex(0xFF, 0x74, 0x1D),
            nav_sessions: hex(0xF5, 0xF0, 0xD8),
            nav_terminal: hex(0x4A, 0x4A, 0x4A),
            nav_todo: hex(0x3A, 0x3A, 0x3A),
            nav_inbox: hex(0x2A, 0x2A, 0x2A),
            nav_notice: hex(0x1A, 0x1A, 0x1A),
            nav_settings: hex(0xC7, 0xFF, 0x20),
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
        set!(sel_bg, t.sel_bg);
        set!(sel_fg, t.sel_fg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_theme_matches_tau_ceti_hex() {
        let t = Theme::default();
        assert_eq!(color_hex(t.bg), "#101010");
        assert_eq!(color_hex(t.fg), "#C5C5C5");
        assert_eq!(color_hex(t.accent), "#C7FF20");
        assert_eq!(color_hex(t.accent2), "#3BFFA7");
        assert_eq!(color_hex(t.warn), "#FFD900");
        assert_eq!(color_hex(t.err), "#FF741D");
        assert_eq!(color_hex(t.info), "#2121FF");
        assert_eq!(color_hex(t.user), "#FFFFFF");
        assert_eq!(color_hex(t.assistant), "#C5C5C5");
        assert_eq!(color_hex(t.system), "#8363FF");
        assert_eq!(color_hex(t.tool), "#C7FF20");
        assert_eq!(color_hex(t.tool_result), "#3BFFA7");
        assert_eq!(color_hex(t.user_bg), "#242424");
        assert_eq!(color_hex(t.footer_bg), "#C5C5C5");
        assert_eq!(color_hex(t.input_field_bg), "#B0B0B0");
        assert_eq!(color_hex(t.border), "#242424");
        assert_eq!(color_hex(t.md_heading2), "#3BFFA7");
        assert_eq!(color_hex(t.md_heading3), "#FFD900");
        assert_eq!(color_hex(t.md_link), "#2121FF");
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
        assert_eq!(color_hex(t.bg), "#101010");
    }
}
