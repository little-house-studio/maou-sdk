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

/// 居中并 **左右都补空格到 w 列**（否则右侧无字符 → 背景色只铺半行）。
pub(crate) fn center(s: &str, w: usize) -> String {
    if w == 0 {
        return String::new();
    }
    let tw = UnicodeWidthStr::width(s);
    if tw >= w {
        return trunc(s, w);
    }
    let left = (w - tw) / 2;
    let right = w - tw - left;
    format!("{}{}{}", " ".repeat(left), s, " ".repeat(right))
}

pub(crate) fn prev_char_boundary(s: &str, idx: usize) -> usize {
    // 半码点：先 snap 到当前码点起点（= 退格应删的整字起点）。
    // 已在边界：再退一个完整码点。
    let idx = idx.min(s.len());
    if idx == 0 {
        return 0;
    }
    if !s.is_char_boundary(idx) {
        // snap down to start of the codepoint containing idx
        let mut i = idx;
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
        return i;
    }
    // on boundary → previous codepoint start
    let mut i = idx - 1;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

pub(crate) fn next_char_boundary(s: &str, idx: usize) -> usize {
    // 半码点：前进到「当前码点之后」；已在边界：前进到下一码点之后
    let idx = idx.min(s.len());
    if idx >= s.len() {
        return s.len();
    }
    let mut i = if s.is_char_boundary(idx) {
        idx + 1
    } else {
        // skip rest of current codepoint
        idx + 1
    };
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

pub(crate) fn prev_word_boundary(s: &str, cursor: usize) -> usize {
    // 先钳到合法边界，避免 cursor 越界或半码点
    let mut pos = snap_idx(s, cursor);
    let bytes = s.as_bytes();
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
    // 必须先落到合法 UTF-8 边界，否则 s[..c] / 下标会 panic
    let c = snap_idx(s, cursor);
    if c == 0 {
        return 0;
    }
    let bytes = s.as_bytes();
    let mut i = c;
    // skip trailing whitespace
    while i > 0 && matches!(bytes[i - 1], b' ' | b'\t' | b'\r') {
        i -= 1;
    }
    // 回退后可能落在码点中间
    i = snap_idx(s, i);
    while i > 0 {
        let ch = s[..i].chars().last().unwrap_or(' ');
        if ch == '\n' || ".!?。！？…".contains(ch) {
            return i;
        }
        i = prev_char_boundary(s, i);
    }
    0
}

/// Snap index down to a char boundary (or 0 / len). Never panics.
fn snap_idx(s: &str, mut i: usize) -> usize {
    i = i.min(s.len());
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Byte index of the start of the line containing `cursor` (after previous `\n`, or 0).
pub(crate) fn line_start(s: &str, cursor: usize) -> usize {
    let c = snap_idx(s, cursor);
    s[..c].rfind('\n').map(|i| i + 1).unwrap_or(0)
}

/// Byte index of the end of the line containing `cursor` (before next `\n`, or len).
pub(crate) fn line_end(s: &str, cursor: usize) -> usize {
    let c = snap_idx(s, cursor);
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
/// `body_width` = soft-wrap width for input bar; pass `usize::MAX/4` for hard-lines-only (FSE).
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
    body_width: usize,
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
    use super::input_paint::{display_row_of_cursor, input_display_rows};
    let rows = input_display_rows(text, body_width.max(1));
    let line_of = display_row_of_cursor(&rows, cur);
    let view_h = rect_h as usize;
    let n_lines = rows.len().max(1);
    let vs = view_start_line.min(n_lines.saturating_sub(1));
    let rel = if line_of < vs {
        0
    } else if line_of >= vs + view_h {
        view_h.saturating_sub(1)
    } else {
        line_of - vs
    };
    let r = rows.get(line_of).copied();
    let (seg_start, seg_end) = r
        .map(|row| (row.abs_start.min(text.len()), row.abs_end.min(text.len())))
        .unwrap_or((0, text.len()));
    let a = {
        let mut i = seg_start;
        while i > 0 && !text.is_char_boundary(i) {
            i -= 1;
        }
        i
    };
    let b = {
        let mut i = seg_end.min(text.len());
        while i > 0 && !text.is_char_boundary(i) {
            i -= 1;
        }
        i.max(a)
    };
    let line_text = &text[a..b];
    let in_line = cur.saturating_sub(a).min(line_text.len());
    let vcol = crate::mouse::byte_to_visual_col(line_text, in_line);
    let raw_col = text_origin_x as usize + vcol;
    let col = (raw_col as u16).min(screen_cols.saturating_sub(1)).max(0);
    let row = rect_y
        .saturating_add(rel as u16)
        .min(screen_rows.saturating_sub(1));
    let col = col
        .max(rect_x)
        .min(rect_x.saturating_add(rect_w.saturating_sub(1)))
        .min(screen_cols.saturating_sub(1));
    let _ = rect_x;
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
        caret_raw_col_overflows, caret_screen_pos, max_line_visual_width,
        next_char_boundary, prev_char_boundary, scrub_input,
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
        let (col, row) =
            caret_screen_pos(text, cur, 0, 10, 40, 4, 3, 0, 80, 24, usize::MAX / 4).unwrap();
        assert_eq!(row, 10);
        // origin 3 + width(你)=2 → col 5
        assert_eq!(col, 5);
    }

    #[test]
    fn caret_screen_pos_multiline_view() {
        let text = "a\nb\nc";
        // cursor after "c"
        let cur = text.len();
        let (col, row) =
            caret_screen_pos(text, cur, 0, 20, 40, 2, 3, 1, 80, 40, usize::MAX / 4).unwrap();
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

    #[test]
    fn prev_next_char_boundary_mid_utf8() {
        let s = "a你b";
        // 你 starts at 1, len 3 → bytes 1..4
        let mid = 2;
        assert!(!s.is_char_boundary(mid));
        // prev from mid → start of 你 (1)
        assert_eq!(prev_char_boundary(s, mid), 1);
        // prev from start of 你 → 'a' at 0
        assert_eq!(prev_char_boundary(s, 1), 0);
        // next from mid → after 你 (4)
        assert_eq!(next_char_boundary(s, mid), 4);
        // next from start of 你 → after 你
        assert_eq!(next_char_boundary(s, 1), 4);
        // next from end
        assert_eq!(next_char_boundary(s, s.len()), s.len());
        // prev from 0
        assert_eq!(prev_char_boundary(s, 0), 0);
    }
}
