//! String / cursor boundary helpers shared by input editing and layout.

use unicode_width::UnicodeWidthStr;

pub(crate) fn trunc(s: &str, w: usize) -> String {
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

pub(crate) fn center(s: &str, w: usize) -> String {
    let tw = UnicodeWidthStr::width(s);
    if tw >= w {
        return trunc(s, w);
    }
    let pad = (w - tw) / 2;
    format!("{}{}", " ".repeat(pad), s)
}

pub(crate) fn prev_char_boundary(s: &str, idx: usize) -> usize {
    if idx == 0 {
        return 0;
    }
    let mut i = idx - 1;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

pub(crate) fn next_char_boundary(s: &str, idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    let mut i = idx + 1;
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

pub(crate) fn prev_word_boundary(s: &str, cursor: usize) -> usize {
    let bytes = s.as_bytes();
    let mut pos = cursor;
    while pos > 0 && bytes[pos - 1].is_ascii_whitespace() {
        pos -= 1;
    }
    while pos > 0 && !bytes[pos - 1].is_ascii_whitespace() {
        pos -= 1;
    }
    // adjust to char boundary
    while pos > 0 && !s.is_char_boundary(pos) {
        pos -= 1;
    }
    pos
}

pub(crate) fn prev_sentence_boundary(s: &str, cursor: usize) -> usize {
    let c = cursor.min(s.len());
    if c == 0 {
        return 0;
    }
    let bytes = s.as_bytes();
    let mut i = c;
    // skip trailing whitespace
    while i > 0 && matches!(bytes[i - 1], b' ' | b'\t' | b'\r') {
        i -= 1;
    }
    while i > 0 {
        let ch = s[..i].chars().last().unwrap_or(' ');
        if ch == '\n' || ".!?。！？…".contains(ch) {
            return i;
        }
        i = prev_char_boundary(s, i);
    }
    0
}

/// Byte index of the start of the line containing `cursor` (after previous `\n`, or 0).
pub(crate) fn line_start(s: &str, cursor: usize) -> usize {
    let c = cursor.min(s.len());
    s[..c].rfind('\n').map(|i| i + 1).unwrap_or(0)
}

/// Byte index of the end of the line containing `cursor` (before next `\n`, or len).
pub(crate) fn line_end(s: &str, cursor: usize) -> usize {
    let c = cursor.min(s.len());
    s[c..].find('\n').map(|i| c + i).unwrap_or(s.len())
}

/// Max visual width of any logical line (for IME overflow latch / I03).
pub(crate) fn max_line_visual_width(s: &str) -> usize {
    use unicode_width::UnicodeWidthStr;
    s.split('\n')
        .map(UnicodeWidthStr::width)
        .max()
        .unwrap_or(0)
}

/// 0-based screen (col, row) for hidden hardware cursor pin (Ink pinHardwareCursorForIme).
/// `text_origin_x` = first column of text body (after prompt for input bar; rect.x for FSE).
/// Returns None if rect invalid.
pub(crate) fn caret_screen_pos(
    text: &str,
    cursor: usize,
    rect_x: u16,
    rect_y: u16,
    rect_w: u16,
    rect_h: u16,
    text_origin_x: u16,
    view_start_line: usize,
    screen_cols: u16,
    screen_rows: u16,
) -> Option<(u16, u16)> {
    if rect_w == 0 || rect_h == 0 || screen_cols == 0 || screen_rows == 0 {
        return None;
    }
    let cur = {
        let mut c = cursor.min(text.len());
        while c > 0 && !text.is_char_boundary(c) {
            c -= 1;
        }
        c
    };
    let line_of = text[..cur].bytes().filter(|&b| b == b'\n').count();
    let view_h = rect_h as usize;
    let n_lines = text.split('\n').count().max(1);
    let vs = view_start_line.min(n_lines.saturating_sub(1));
    // Clamp cursor line into visible window (same idea as input_view_start)
    let rel = if line_of < vs {
        0
    } else if line_of >= vs + view_h {
        view_h.saturating_sub(1)
    } else {
        line_of - vs
    };
    let line_start = line_start(text, cur);
    let line_end_b = line_end(text, cur);
    let line_text = &text[line_start..line_end_b];
    let in_line = cur.saturating_sub(line_start).min(line_text.len());
    let vcol = crate::mouse::byte_to_visual_col(line_text, in_line);
    let raw_col = text_origin_x as usize + vcol;
    // Clamp into screen (Ink setImePinTarget); out-of-range means overflow latch elsewhere
    let col = (raw_col as u16).min(screen_cols.saturating_sub(1)).max(0);
    let row = rect_y
        .saturating_add(rel as u16)
        .min(screen_rows.saturating_sub(1));
    // Prefer staying inside the input rect horizontally when possible
    let col = col
        .max(rect_x)
        .min(rect_x.saturating_add(rect_w.saturating_sub(1)))
        .min(screen_cols.saturating_sub(1));
    let _ = rect_x; // used above
    Some((col, row))
}

/// Whether raw caret col (before clamp) exceeds screen — Ink overflowLatch signal.
pub(crate) fn caret_raw_col_overflows(
    text: &str,
    cursor: usize,
    text_origin_x: u16,
    screen_cols: u16,
) -> bool {
    let cur = {
        let mut c = cursor.min(text.len());
        while c > 0 && !text.is_char_boundary(c) {
            c -= 1;
        }
        c
    };
    let line_start = line_start(text, cur);
    let line_end_b = line_end(text, cur);
    let line_text = &text[line_start..line_end_b];
    let in_line = cur.saturating_sub(line_start).min(line_text.len());
    let vcol = crate::mouse::byte_to_visual_col(line_text, in_line);
    let raw = text_origin_x as usize + vcol;
    raw >= screen_cols as usize || max_line_visual_width(text) + text_origin_x as usize > screen_cols as usize
}

/// Ink `InputBar.scrubInput`: strip mouse/CSI/SS3 garbage and C0 controls
/// before they land in the draft. Keeps `\t` / `\n` (and `\r` until paste
/// normalizes CRLF). Complements crossterm event filtering when sequences
/// leak via paste or multi-char insert.
pub(crate) fn scrub_input(v: &str) -> String {
    let bytes = v.as_bytes();
    let mut out = String::with_capacity(v.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        // ESC CSI / SS3 / bare ESC
        if b == 0x1b {
            if i + 1 < bytes.len() && bytes[i + 1] == b'[' {
                // CSI: ESC [ intermediate/params final (@-~)
                i += 2;
                while i < bytes.len() {
                    let c = bytes[i];
                    i += 1;
                    if (0x40..=0x7e).contains(&c) {
                        break;
                    }
                }
                continue;
            }
            if i + 1 < bytes.len() && bytes[i + 1] == b'O' {
                // SS3: ESC O X
                i += 2;
                if i < bytes.len() {
                    i += 1;
                }
                continue;
            }
            i += 1;
            continue;
        }
        // Bare mouse SGR tail without ESC: `[ < digits/semicolons M|m`
        if b == b'[' && i + 1 < bytes.len() && bytes[i + 1] == b'<' {
            let mut j = i + 2;
            let mut matched = false;
            while j < bytes.len() {
                let c = bytes[j];
                if c == b'M' || c == b'm' {
                    let body = &bytes[i + 2..j];
                    if !body.is_empty()
                        && body
                            .iter()
                            .all(|x| x.is_ascii_digit() || *x == b';')
                    {
                        i = j + 1;
                        matched = true;
                    }
                    break;
                }
                if !(c.is_ascii_digit() || c == b';') {
                    break;
                }
                j += 1;
            }
            if matched {
                continue;
            }
            // not a mouse sequence — fall through to emit '['
        }
        // C0 controls: drop all except TAB (0x09) and LF (0x0a); keep CR for paste normalize
        if b <= 0x08 || b == 0x0b || b == 0x0c || (0x0e..=0x1f).contains(&b) || b == 0x7f {
            i += 1;
            continue;
        }
        // UTF-8 scalar (or ASCII)
        let start = i;
        i += 1;
        while i < bytes.len() && (bytes[i] & 0xc0) == 0x80 {
            i += 1;
        }
        if let Ok(s) = std::str::from_utf8(&bytes[start..i]) {
            out.push_str(s);
        }
    }
    out
}

#[cfg(test)]
mod scrub_tests {
    use super::{
        caret_raw_col_overflows, caret_screen_pos, max_line_visual_width, scrub_input,
    };

    #[test]
    fn scrub_strips_csi_and_mouse_sgr() {
        let s = format!("hi\x1b[<1;2;3Mthere\x1b[A!");
        assert_eq!(scrub_input(&s), "hithere!");
    }

    #[test]
    fn scrub_strips_ss3_and_c0() {
        let s = format!("a\x1bOAb\x07c\nd");
        assert_eq!(scrub_input(&s), "abc\nd");
    }

    #[test]
    fn scrub_keeps_cjk_and_tab() {
        assert_eq!(scrub_input("你\t好"), "你\t好");
    }

    #[test]
    fn scrub_bare_mouse_without_esc() {
        assert_eq!(scrub_input("x[<10;1;2My"), "xy");
    }

    #[test]
    fn caret_screen_pos_after_prompt_and_cjk() {
        // rect at (0,10), prompt 3 cols, cursor after "你"
        let text = "你a";
        let cur = "你".len(); // 3
        let (col, row) = caret_screen_pos(text, cur, 0, 10, 40, 4, 3, 0, 80, 24).unwrap();
        assert_eq!(row, 10);
        // origin 3 + width(你)=2 → col 5
        assert_eq!(col, 5);
    }

    #[test]
    fn caret_screen_pos_multiline_view() {
        let text = "a\nb\nc";
        // cursor after "c"
        let cur = text.len();
        let (col, row) = caret_screen_pos(text, cur, 0, 20, 40, 2, 3, 1, 80, 40).unwrap();
        // view_start=1 → lines b,c visible; c is rel=1 → row 21
        assert_eq!(row, 21);
        // origin 3 + width("c")=1 → col 4
        assert_eq!(col, 4);
    }

    #[test]
    fn max_line_and_overflow_detect() {
        assert_eq!(max_line_visual_width("ab\n你好xx"), 6); // 你=2 好=2 x x
        assert!(caret_raw_col_overflows("abcdefghij", 10, 0, 8));
        assert!(!caret_raw_col_overflows("hi", 2, 0, 80));
    }
}
