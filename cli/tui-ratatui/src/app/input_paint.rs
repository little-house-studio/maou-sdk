//! Ink InputBar multi-line paint + height/viewport math.
//! Long logical lines soft-wrap to `body_width` display columns (no hard `\n` insert).

use crate::mouse;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

/// Visible rows of the input draft (Ink viewportLines=5).
pub const INPUT_VIEWPORT_LINES: usize = 5;

/// One painted row after soft-wrap (may be a slice of a logical `\n` line).
#[derive(Debug, Clone, Copy)]
pub struct InputDisplayRow {
    /// Absolute byte offset of this segment start in `input`.
    pub abs_start: usize,
    /// Absolute byte offset of segment end (exclusive; may equal next soft piece).
    pub abs_end: usize,
    /// True if this row is the first display row of its logical line (shows `❯ `).
    pub is_first_of_logical: bool,
}

/// Soft-wrap a single logical line into display segments (relative offsets in `line`).
pub fn soft_wrap_segments(line: &str, body_width: usize) -> Vec<(usize, usize)> {
    let w = body_width.max(1);
    if line.is_empty() {
        return vec![(0, 0)];
    }
    let mut segs = Vec::new();
    let mut start = 0usize;
    let mut col = 0usize;
    let mut i = 0usize;
    while i < line.len() {
        let Some(ch) = line[i..].chars().next() else {
            break;
        };
        let cw = UnicodeWidthChar::width(ch).unwrap_or(1).max(1);
        let next = i + ch.len_utf8();
        if col > 0 && col + cw > w {
            segs.push((start, i));
            start = i;
            col = 0;
        }
        // single wide char wider than body: still take one row
        if col == 0 && cw > w {
            segs.push((start, next));
            start = next;
            col = 0;
            i = next;
            continue;
        }
        col += cw;
        i = next;
    }
    if start < line.len() || segs.is_empty() {
        segs.push((start, line.len()));
    }
    segs
}

/// Flatten whole draft into display rows (hard `\n` + soft wrap).
pub fn input_display_rows(input: &str, body_width: usize) -> Vec<InputDisplayRow> {
    let w = body_width.max(1);
    let mut out = Vec::new();
    if input.is_empty() {
        out.push(InputDisplayRow {
            abs_start: 0,
            abs_end: 0,
            is_first_of_logical: true,
        });
        return out;
    }
    let mut abs = 0usize;
    let parts: Vec<&str> = input.split('\n').collect();
    for (li, seg) in parts.iter().enumerate() {
        let pieces = soft_wrap_segments(seg, w);
        for (pi, (a, b)) in pieces.iter().enumerate() {
            out.push(InputDisplayRow {
                abs_start: abs + *a,
                abs_end: abs + *b,
                is_first_of_logical: pi == 0,
            });
        }
        abs += seg.len();
        if li + 1 < parts.len() {
            abs += 1; // '\n'
        }
    }
    if out.is_empty() {
        out.push(InputDisplayRow {
            abs_start: 0,
            abs_end: 0,
            is_first_of_logical: true,
        });
    }
    out
}

/// Display-row index containing `cursor` (clamped).
pub fn display_row_of_cursor(rows: &[InputDisplayRow], cursor: usize) -> usize {
    if rows.is_empty() {
        return 0;
    }
    for (i, r) in rows.iter().enumerate() {
        // last row: include cursor at abs_end / past end
        if cursor < r.abs_end || (cursor == r.abs_end && i + 1 == rows.len()) {
            return i;
        }
        // cursor exactly at soft-wrap boundary → prefer next row start
        if cursor == r.abs_end && i + 1 < rows.len() {
            continue;
        }
        if cursor >= r.abs_start && cursor < r.abs_end {
            return i;
        }
    }
    // between rows (e.g. at soft boundary): find first with abs_start >= cursor
    for (i, r) in rows.iter().enumerate() {
        if r.abs_start >= cursor {
            return i;
        }
    }
    rows.len() - 1
}

/// Map (display_row, visual col in body) → absolute byte index.
pub fn display_row_visual_to_byte(
    input: &str,
    rows: &[InputDisplayRow],
    display_row: usize,
    visual_col: usize,
) -> usize {
    if rows.is_empty() {
        return 0;
    }
    let i = display_row.min(rows.len() - 1);
    let r = rows[i];
    let a = mouse::snap_char_boundary(input, r.abs_start.min(input.len()));
    let b = mouse::snap_char_boundary(input, r.abs_end.min(input.len()));
    if a >= b {
        return a.min(input.len());
    }
    let slice = &input[a..b];
    let off = mouse::visual_col_to_byte(slice, visual_col);
    mouse::snap_char_boundary(input, a + off)
}

/// Visual column of `cursor` within its display row body.
pub fn display_row_visual_col(input: &str, rows: &[InputDisplayRow], cursor: usize) -> usize {
    if rows.is_empty() {
        return 0;
    }
    let cur = mouse::snap_char_boundary(input, cursor.min(input.len()));
    let i = display_row_of_cursor(rows, cur);
    let r = rows[i];
    let a = mouse::snap_char_boundary(input, r.abs_start.min(input.len()));
    let b = mouse::snap_char_boundary(input, r.abs_end.min(input.len()));
    if a >= b || cur <= a {
        return 0;
    }
    let end = cur.min(b);
    mouse::byte_to_visual_col(&input[a..b.min(input.len())], end.saturating_sub(a))
}

/// Move cursor ±1 **display** row (soft-wrap aware), preserving visual column.
/// Returns new byte cursor. Unchanged if already on first/last display row.
pub fn shift_cursor_display_row(
    input: &str,
    cursor: usize,
    body_width: usize,
    dir_up: bool,
) -> usize {
    let rows = input_display_rows(input, body_width.max(1));
    if rows.is_empty() {
        return 0;
    }
    let cur = mouse::snap_char_boundary(input, cursor.min(input.len()));
    let i = display_row_of_cursor(&rows, cur);
    let vcol = display_row_visual_col(input, &rows, cur);
    if dir_up {
        if i == 0 {
            return cur;
        }
        display_row_visual_to_byte(input, &rows, i - 1, vcol)
    } else if i + 1 >= rows.len() {
        cur
    } else {
        display_row_visual_to_byte(input, &rows, i + 1, vcol)
    }
}

/// Byte start of the display row containing `cursor`.
pub fn display_row_home(input: &str, cursor: usize, body_width: usize) -> usize {
    let rows = input_display_rows(input, body_width.max(1));
    if rows.is_empty() {
        return 0;
    }
    let cur = mouse::snap_char_boundary(input, cursor.min(input.len()));
    let i = display_row_of_cursor(&rows, cur);
    mouse::snap_char_boundary(input, rows[i].abs_start.min(input.len()))
}

/// Byte end of the display row containing `cursor` (before soft-wrap break / hard `\n`).
pub fn display_row_end(input: &str, cursor: usize, body_width: usize) -> usize {
    let rows = input_display_rows(input, body_width.max(1));
    if rows.is_empty() {
        return 0;
    }
    let cur = mouse::snap_char_boundary(input, cursor.min(input.len()));
    let i = display_row_of_cursor(&rows, cur);
    let r = rows[i];
    // For last display piece of a logical line ending mid-wrap, abs_end is fine;
    // if at true EOF, use len.
    mouse::snap_char_boundary(input, r.abs_end.min(input.len()))
}

pub fn input_height(input: &str, body_width: usize) -> usize {
    input_display_rows(input, body_width)
        .len()
        .max(1)
        .min(INPUT_VIEWPORT_LINES)
}

/// First **display** row index when draft exceeds viewport (legacy: body width = huge → hard lines only).
pub fn input_view_start(input: &str, cursor: usize) -> usize {
    input_view_start_with_offset(input, cursor, None, usize::MAX / 4)
}

pub fn input_view_start_with_offset(
    input: &str,
    cursor: usize,
    manual_offset: Option<usize>,
    body_width: usize,
) -> usize {
    let rows = input_display_rows(input, body_width);
    let n = rows.len().max(1);
    let max_start = n.saturating_sub(INPUT_VIEWPORT_LINES);
    if n <= INPUT_VIEWPORT_LINES {
        return 0;
    }
    let cur = mouse::snap_char_boundary(input, cursor.min(input.len()));
    let line_of = display_row_of_cursor(&rows, cur);
    let preferred = manual_offset.unwrap_or_else(|| {
        line_of
            .saturating_sub(INPUT_VIEWPORT_LINES.saturating_sub(1))
            .min(max_start)
    });
    let mut start = preferred.min(max_start);
    if line_of < start {
        start = line_of;
    } else if line_of >= start + INPUT_VIEWPORT_LINES {
        start = line_of + 1 - INPUT_VIEWPORT_LINES;
    }
    start.min(max_start)
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
                // paint char by char for caret (reverse video, not ▌ glyph)
                let mut k = i;
                while k < j {
                    let Some(ch) = line_text[k..].chars().next() else {
                        break;
                    };
                    let len = ch.len_utf8();
                    let at = line_start + k;
                    if show_caret && cursor == at {
                        spans.push(Span::styled(
                            ch.to_string(),
                            caret_style(slash_style),
                        ));
                    } else {
                        spans.push(Span::styled(ch.to_string(), slash_style));
                    }
                    k += len;
                }
                i = j;
                continue;
            }
        }
        // normal char — 若 i 不在码点边界则推进到下一边界，避免 panic
        let Some(ch) = line_text[i..].chars().next() else {
            break;
        };
        let len = ch.len_utf8();
        let at = line_start + i;
        if show_caret && cursor == at {
            spans.push(Span::styled(ch.to_string(), caret_style(body_style)));
        } else {
            spans.push(Span::styled(ch.to_string(), body_style));
        }
        i += len;
        let _ = abs;
    }
    if show_caret && cursor == line_end {
        // end-of-line: reverse space (block caret without solid glyph icon)
        spans.push(Span::styled(" ".to_string(), caret_style(body_style)));
    }
    spans
}

/// Bottom input caret: reverse fg/bg of the cell (not a solid ▌ icon).
fn caret_style(base: Style) -> Style {
    let fg = base.bg.unwrap_or(Color::Rgb(0xb0, 0xb0, 0xb0));
    let bg = base.fg.unwrap_or(Color::Black);
    Style::default()
        .fg(fg)
        .bg(bg)
        .add_modifier(Modifier::BOLD)
}

pub fn paint_input_lines_ink(
    input: &str,
    cursor: usize,
    footer_bg: Color,
    field_bg: Color,
    show_caret: bool,
) -> Vec<Line<'static>> {
    paint_input_lines_ink_offset(
        input,
        cursor,
        footer_bg,
        field_bg,
        show_caret,
        None,
        usize::MAX / 4,
    )
}

pub fn paint_input_lines_ink_offset(
    input: &str,
    cursor: usize,
    footer_bg: Color,
    field_bg: Color,
    show_caret: bool,
    view_offset: Option<usize>,
    body_width: usize,
) -> Vec<Line<'static>> {
    let cursor = mouse::snap_char_boundary(input, cursor);
    let prompt = mouse::PROMPT_STR;
    // Same display width as PROMPT (❯ + space = 2) for continuation rows
    const PROMPT_PAD: &str = "  ";

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

    let rows = input_display_rows(input, body_width);
    let n = rows.len().max(1);
    let h = n.min(INPUT_VIEWPORT_LINES);
    let start = input_view_start_with_offset(input, cursor, view_offset, body_width);
    let end = (start + h).min(n);

    let mut out: Vec<Line<'static>> = Vec::with_capacity(h);
    for vis_i in 0..(end - start) {
        let ri = start + vis_i;
        let row = rows[ri];
        let a = mouse::snap_char_boundary(input, row.abs_start.min(input.len()));
        let b = mouse::snap_char_boundary(input, row.abs_end.min(input.len()));
        let line_text = if a <= b && b <= input.len() {
            &input[a..b]
        } else {
            ""
        };

        let mut spans: Vec<Span<'static>> = vec![if row.is_first_of_logical {
            Span::styled(prompt.to_string(), prompt_style)
        } else {
            Span::styled(PROMPT_PAD.to_string(), pad_style)
        }];

        spans.extend(paint_line_body(
            line_text,
            a,
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
            spans.push(Span::styled(" ".to_string(), caret_style(body_style)));
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
    fn height_caps_at_viewport() {
        assert_eq!(
            input_height("a\nb\nc\nd\ne\nf", 80),
            INPUT_VIEWPORT_LINES
        );
        assert_eq!(input_height("a", 80), 1);
    }

    #[test]
    fn soft_wrap_long_line_raises_height() {
        let long = "x".repeat(40);
        assert_eq!(input_height(&long, 10), 4); // 40/10 = 4 rows
        assert!(input_display_rows(&long, 10).len() == 4);
    }

    #[test]
    fn paint_has_prompt() {
        let footer = Color::Gray;
        let field = Color::DarkGray;
        let lines = paint_input_lines_ink("hi", 2, footer, field, true);
        let plain = input_lines_plain(&lines).join("");
        assert!(plain.contains('❯') || plain.contains("hi"));
    }

    #[test]
    fn soft_wrap_cursor_maps_to_second_row() {
        let s = "abcdefghij"; // 10 chars, width 4 → 3 rows (4+4+2)
        let rows = input_display_rows(s, 4);
        assert_eq!(rows.len(), 3);
        assert_eq!(display_row_of_cursor(&rows, 0), 0);
        // soft boundary at 4: prefer next row start
        assert_eq!(display_row_of_cursor(&rows, 4), 1);
        assert_eq!(display_row_of_cursor(&rows, 5), 1);
        assert_eq!(display_row_of_cursor(&rows, 8), 2);
        let b = display_row_visual_to_byte(s, &rows, 1, 1);
        assert_eq!(&s[b..b + 1], "f"); // second row "efgh", col 1 → 'f'
    }

    #[test]
    fn soft_wrap_arrow_up_down_and_home_end() {
        let s = "abcdefghij"; // width 4 → rows abc d / efgh / ij
        // cursor on 'f' (index 5) → display row 1
        assert_eq!(display_row_of_cursor(&input_display_rows(s, 4), 5), 1);
        // Down from 'b' (1) → same visual col on row1 → 'f' (5)
        let down = shift_cursor_display_row(s, 1, 4, false);
        assert_eq!(down, 5);
        // Up from 'f' → back toward 'b'
        let up = shift_cursor_display_row(s, 5, 4, true);
        assert_eq!(up, 1);
        // Home/End on middle display row "efgh"
        assert_eq!(display_row_home(s, 5, 4), 4);
        assert_eq!(display_row_end(s, 5, 4), 8);
    }
}
