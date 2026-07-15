//! Ink InputBar multi-line paint + height/viewport math.

use crate::mouse;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use unicode_width::UnicodeWidthStr;

pub fn input_height(input: &str) -> usize {
    input.split('\n').count().max(1).min(4)
}

/// First logical line index shown when draft has more than 4 lines (Ink viewportLines=4).
/// Window is pinned so the cursor line stays visible.
pub fn input_view_start(input: &str, cursor: usize) -> usize {
    let n = input.split('\n').count().max(1);
    if n <= 4 {
        return 0;
    }
    let cur = mouse::snap_char_boundary(input, cursor.min(input.len()));
    let line_of = input[..cur].bytes().filter(|&b| b == b'\n').count();
    // Prefer keeping cursor near bottom of 4-line window (natural typing)
    line_of.saturating_sub(3).min(n.saturating_sub(4))
}

/// Ink computer-blue for known `/command` tokens in the field.
const SLASH_CMD_FG: Color = Color::Rgb(0x21, 0x21, 0xFF);

/// Whether a token looks like a slash command label (Ink buildCommandLabels-ish).
fn is_slash_token(tok: &str) -> bool {
    let t = tok.trim();
    if !t.starts_with('/') || t.len() < 2 {
        return false;
    }
    // /model, /new, /sessions, /help …
    t[1..]
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Paint one logical line body with optional caret + slash highlighting.
fn paint_line_body(
    line_text: &str,
    line_start: usize,
    cursor: usize,
    show_caret: bool,
    body_style: Style,
    slash_style: Style,
) -> Vec<Span<'static>> {
    let mut spans: Vec<Span<'static>> = Vec::new();
    let line_end = line_start + line_text.len();

    // Split into slash-tokens and rest while tracking absolute byte indices
    let bytes = line_text.as_bytes();
    let mut i = 0usize; // offset within line_text
    while i < line_text.len() {
        let abs = line_start + i;
        // try slash token
        if bytes[i] == b'/' {
            let mut j = i + 1;
            while j < line_text.len() {
                let ch = line_text[j..].chars().next().unwrap_or(' ');
                if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                    j += ch.len_utf8();
                } else {
                    break;
                }
            }
            let tok = &line_text[i..j];
            if is_slash_token(tok) {
                // paint char by char for caret
                let mut k = i;
                while k < j {
                    let ch = line_text[k..].chars().next().unwrap();
                    let len = ch.len_utf8();
                    let at = line_start + k;
                    let s = if show_caret && cursor == at {
                        format!("▌{ch}")
                    } else {
                        ch.to_string()
                    };
                    spans.push(Span::styled(s, slash_style));
                    k += len;
                }
                i = j;
                continue;
            }
        }
        // normal char
        let ch = line_text[i..].chars().next().unwrap();
        let len = ch.len_utf8();
        let at = line_start + i;
        let s = if show_caret && cursor == at {
            format!("▌{ch}")
        } else {
            ch.to_string()
        };
        spans.push(Span::styled(s, body_style));
        i += len;
        let _ = abs;
    }
    if show_caret && cursor == line_end {
        spans.push(Span::styled("▌".to_string(), body_style));
    }
    spans
}

pub fn paint_input_lines_ink(
    input: &str,
    cursor: usize,
    footer_bg: Color,
    field_bg: Color,
    show_caret: bool,
) -> Vec<Line<'static>> {
    let cursor = mouse::snap_char_boundary(input, cursor);
    let prompt = mouse::PROMPT_STR;
    // Same display width as PROMPT (space + ❯ + space = 3) for continuation rows
    const PROMPT_PAD: &str = "   ";

    let prompt_style = Style::default()
        .fg(Color::Black)
        .bg(footer_bg)
        .add_modifier(Modifier::BOLD);
    let pad_style = Style::default().fg(Color::Black).bg(footer_bg);
    let body_style = Style::default().fg(Color::Black).bg(field_bg);
    let slash_style = Style::default()
        .fg(SLASH_CMD_FG)
        .bg(field_bg)
        .add_modifier(Modifier::BOLD);

    let all: Vec<&str> = input.split('\n').collect();
    let n = all.len().max(1);
    let h = n.min(4);
    let start = input_view_start(input, cursor);
    let end = (start + h).min(n);

    // Byte offset of the start of each logical line
    let mut line_starts: Vec<usize> = Vec::with_capacity(n);
    let mut off = 0usize;
    for (i, seg) in all.iter().enumerate() {
        line_starts.push(off);
        off += seg.len();
        if i + 1 < n {
            off += 1; // '\n'
        }
    }

    let mut out: Vec<Line<'static>> = Vec::with_capacity(h);
    for vis_i in 0..(end - start) {
        let li = start + vis_i;
        let line_text = all.get(li).copied().unwrap_or("");
        let line_start = *line_starts.get(li).unwrap_or(&0);

        let mut spans: Vec<Span<'static>> = vec![if vis_i == 0 {
            Span::styled(prompt.to_string(), prompt_style)
        } else {
            Span::styled(PROMPT_PAD.to_string(), pad_style)
        }];

        spans.extend(paint_line_body(
            line_text,
            line_start,
            cursor,
            show_caret,
            body_style,
            slash_style,
        ));

        out.push(Line::from(spans));
    }
    if out.is_empty() {
        let mut spans = vec![Span::styled(prompt.to_string(), prompt_style)];
        if show_caret {
            spans.push(Span::styled("▌".to_string(), body_style));
        }
        out.push(Line::from(spans));
    }
    out
}

/// Line-level MD style for FSE (Ink FullScreenEditor MD_LABELS — markers only, no block layout).
fn md_line_base_style(line: &str, fg: Color, bg: Color) -> Style {
    let t = line.trim_start();
    if t.starts_with('#') {
        return Style::default()
            .fg(Color::Rgb(0x7A, 0xA2, 0xF7))
            .bg(bg)
            .add_modifier(Modifier::BOLD);
    }
    if t.starts_with('>') {
        return Style::default().fg(Color::Rgb(0x9C, 0xA0, 0xB0)).bg(bg);
    }
    if t.starts_with("- ") || t.starts_with("* ") {
        return Style::default().fg(fg).bg(bg);
    }
    Style::default().fg(fg).bg(bg)
}

/// Inline MD spans: `code`, **bold**, *italic* (simplified Ink labels).
fn paint_md_inline(
    line_text: &str,
    line_start: usize,
    cursor: usize,
    show_caret: bool,
    base: Style,
    bg: Color,
) -> Vec<Span<'static>> {
    let code_st = Style::default().fg(Color::Rgb(0x9E, 0xCE, 0x6A)).bg(bg);
    let bold_st = base.add_modifier(Modifier::BOLD);
    let italic_st = base.add_modifier(Modifier::ITALIC);
    let mut spans = Vec::new();
    let chars: Vec<(usize, char)> = {
        let mut v = Vec::new();
        let mut off = 0usize;
        for ch in line_text.chars() {
            v.push((off, ch));
            off += ch.len_utf8();
        }
        v
    };
    let mut i = 0usize; // index into chars
    while i < chars.len() {
        let (rel, ch) = chars[i];
        let abs = line_start + rel;

        // `code`
        if ch == '`' {
            if let Some(end_i) = chars[i + 1..].iter().position(|(_, c)| *c == '`') {
                let end_idx = i + 1 + end_i;
                // paint whole `...`
                for j in i..=end_idx {
                    let (r, c) = chars[j];
                    let a = line_start + r;
                    let s = if show_caret && cursor == a {
                        format!("▌{c}")
                    } else {
                        c.to_string()
                    };
                    spans.push(Span::styled(s, code_st));
                }
                i = end_idx + 1;
                continue;
            }
        }
        // ~~strike~~
        if ch == '~' && chars.get(i + 1).map(|(_, c)| *c) == Some('~') {
            if let Some(end_rel) = chars[i + 2..]
                .windows(2)
                .position(|w| w[0].1 == '~' && w[1].1 == '~')
            {
                let end_idx = i + 2 + end_rel + 1;
                let strike_st = base
                    .add_modifier(Modifier::CROSSED_OUT)
                    .fg(Color::Rgb(0x80, 0x80, 0x80));
                for j in i..=end_idx {
                    let (r, c) = chars[j];
                    let a = line_start + r;
                    let s = if show_caret && cursor == a {
                        format!("▌{c}")
                    } else {
                        c.to_string()
                    };
                    spans.push(Span::styled(s, strike_st));
                }
                i = end_idx + 1;
                continue;
            }
        }
        // **bold**
        if ch == '*' && chars.get(i + 1).map(|(_, c)| *c) == Some('*') {
            if let Some(end_rel) = chars[i + 2..].windows(2).position(|w| w[0].1 == '*' && w[1].1 == '*') {
                let end_idx = i + 2 + end_rel + 1;
                for j in i..=end_idx {
                    let (r, c) = chars[j];
                    let a = line_start + r;
                    let s = if show_caret && cursor == a {
                        format!("▌{c}")
                    } else {
                        c.to_string()
                    };
                    spans.push(Span::styled(s, bold_st));
                }
                i = end_idx + 1;
                continue;
            }
        }
        // *italic* single star (not **)
        if ch == '*' && chars.get(i + 1).map(|(_, c)| *c) != Some('*') {
            if let Some(end_i) = chars[i + 1..].iter().position(|(_, c)| *c == '*') {
                let end_idx = i + 1 + end_i;
                // avoid empty
                if end_idx > i + 1 {
                    for j in i..=end_idx {
                        let (r, c) = chars[j];
                        let a = line_start + r;
                        let s = if show_caret && cursor == a {
                            format!("▌{c}")
                        } else {
                            c.to_string()
                        };
                        spans.push(Span::styled(s, italic_st));
                    }
                    i = end_idx + 1;
                    continue;
                }
            }
        }

        let s = if show_caret && cursor == abs {
            format!("▌{ch}")
        } else {
            ch.to_string()
        };
        // list bullet highlight
        let st = if (ch == '-' || ch == '*') && rel == 0
            || (line_text.trim_start().starts_with("- ") || line_text.trim_start().starts_with("* "))
                && rel < line_text.len().saturating_sub(line_text.trim_start().len()) + 1
        {
            Style::default().fg(Color::Rgb(0xE0, 0xAF, 0x68)).bg(bg)
        } else {
            base
        };
        spans.push(Span::styled(s, st));
        i += 1;
    }
    spans
}

/// Full-screen editor paint with software caret + light MD coloring (Ink FSE).
pub fn paint_full_editor_lines(
    text: &str,
    cursor: usize,
    fg: Color,
    bg: Color,
    show_caret: bool,
) -> Vec<Line<'static>> {
    let cursor = mouse::snap_char_boundary(text, cursor.min(text.len()));
    let all: Vec<&str> = if text.is_empty() {
        vec![""]
    } else {
        text.split('\n').collect()
    };
    let mut line_starts: Vec<usize> = Vec::with_capacity(all.len());
    let mut off = 0usize;
    for (i, seg) in all.iter().enumerate() {
        line_starts.push(off);
        off += seg.len();
        if i + 1 < all.len() {
            off += 1;
        }
    }
    let mut out = Vec::with_capacity(all.len() + 1);
    for (li, line_text) in all.iter().enumerate() {
        let line_start = line_starts[li];
        let line_end = line_start + line_text.len();
        let base = md_line_base_style(line_text, fg, bg);
        let mut spans = paint_md_inline(line_text, line_start, cursor, show_caret, base, bg);
        if show_caret && cursor == line_end {
            spans.push(Span::styled("▌".to_string(), base));
        }
        if spans.is_empty() && show_caret && cursor == line_start {
            spans.push(Span::styled("▌".to_string(), base));
        }
        out.push(Line::from(spans));
    }
    // footer stats
    let chars = text.chars().count();
    let lines = all.len().max(1);
    out.push(Line::from(Span::styled(
        format!(" {chars} 字 · {lines} 行 · Esc 返回 · Ctrl+S 发送 "),
        Style::default().fg(Color::DarkGray).bg(bg),
    )));
    out
}

/// Flatten painted input lines to plain text (tests / VRAM-ish extract of draft paint).
pub fn input_lines_plain(lines: &[Line<'_>]) -> Vec<String> {
    lines
        .iter()
        .map(|l| l.spans.iter().map(|s| s.content.as_ref()).collect::<String>())
        .collect()
}

pub(crate) fn trim_to_width(s: &str, max_w: usize) -> String {
    if max_w == 0 {
        return String::new();
    }
    if UnicodeWidthStr::width(s) <= max_w {
        return s.to_string();
    }
    let mut out = String::new();
    let mut w = 0usize;
    for ch in s.chars() {
        let cw = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1);
        if w + cw > max_w.saturating_sub(1) {
            break;
        }
        out.push(ch);
        w += cw;
    }
    out.push('…');
    out
}

/// Center `s` in a field of display width `w` (pad spaces; trim if too wide).
pub fn center_in_width(s: &str, w: usize) -> String {
    if w == 0 {
        return String::new();
    }
    let tw = UnicodeWidthStr::width(s);
    if tw >= w {
        return trim_to_width(s, w);
    }
    let pad = (w - tw) / 2;
    format!("{}{}{}", " ".repeat(pad), s, " ".repeat(w - tw - pad))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::style::Color;

    #[test]
    fn height_caps_at_4() {
        assert_eq!(input_height("a\nb\nc\nd\ne"), 4);
        assert_eq!(input_height("a"), 1);
    }

    #[test]
    fn paint_has_prompt() {
        let footer = Color::Gray;
        let field = Color::DarkGray;
        let lines = paint_input_lines_ink("hi", 2, footer, field, true);
        let plain = input_lines_plain(&lines).join("");
        assert!(plain.contains('❯') || plain.contains("hi"));
    }
}
