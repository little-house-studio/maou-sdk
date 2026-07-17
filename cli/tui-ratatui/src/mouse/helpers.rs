//! Pure selection helpers: extract, geometry, toast format, wheel routing, caret.

use super::types::*;
use crate::vram::Vram;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

pub fn sel_style_colors(phase: SelPhase) -> (Color, Color) {
    match phase {
        SelPhase::Flash => (SEL_FLASH_FG, SEL_FLASH_BG),
        SelPhase::Live | SelPhase::Settled => (SEL_FG, SEL_BG),
        SelPhase::None => (SEL_FG, SEL_BG),
    }
}

/// 选择区单元格样式（对齐 Ink sel-fx）：
/// Live/Settled = 纯色计算机蓝 #2121FF + 浅字；Flash 保持闪白。
pub fn sel_cell_style(phase: SelPhase) -> Style {
    use ratatui::style::Modifier;
    match phase {
        SelPhase::None => Style::default(),
        SelPhase::Flash => Style::default().fg(SEL_FLASH_FG).bg(SEL_FLASH_BG),
        SelPhase::Live | SelPhase::Settled => Style::default()
            .fg(SEL_FG)
            .bg(SEL_BG)
            .add_modifier(Modifier::BOLD),
    }
}

/// Ink: insert caret vs selection are mutually exclusive.
/// When input has non-empty text sel, do **not** paint ▌ insert mark.
pub fn should_paint_insert_caret(input_sel: Option<(usize, usize)>) -> bool {
    match input_sel {
        Some((a, b)) if a != b => false,
        _ => true,
    }
}

/// Ink InputBar prompt `" ❯ "` display columns.
/// Prompt without leading pad (format: `❯ 输入…` flush with chrome content).
pub const PROMPT_STR: &str = "❯ ";
pub fn prompt_cols() -> u16 {
    UnicodeWidthStr::width(PROMPT_STR) as u16
}
pub(crate) fn normalize_abs(ay: i64, ac: u16, by: i64, bc: u16) -> (i64, u16, i64, u16) {
    if ay < by || (ay == by && ac <= bc) {
        (ay, ac, by, bc)
    } else {
        (by, bc, ay, ac)
    }
}

pub(crate) fn normalize_cell(a: CellPos, b: CellPos) -> (CellPos, CellPos) {
    if a.row < b.row || (a.row == b.row && a.col <= b.col) {
        (a, b)
    } else {
        (b, a)
    }
}

pub fn extract_chat(c: &ChatSel, scroll_plain: &[String]) -> String {
    let (y1, c1, y2, c2) = normalize_abs(c.a_y, c.a_col, c.b_y, c.b_col);
    let mut lines: Vec<String> = Vec::new();
    for y in y1..=y2 {
        let t = c
            .line_cache
            .get(&y)
            .cloned()
            .or_else(|| scroll_plain.get(y as usize).cloned())
            .unwrap_or_default();
        // strip logo indent for copy? Ink copies screen cells as-is.
        // We store full painted plain lines — OK.
        let line_cols = UnicodeWidthStr::width(t.as_str());
        let (cs, ce) = if y1 == y2 {
            (c1 as usize, c2 as usize)
        } else if y == y1 {
            (c1 as usize, line_cols.saturating_sub(1).max(c1 as usize))
        } else if y == y2 {
            (0, c2 as usize)
        } else {
            (0, line_cols)
        };
        let cs = cs.min(line_cols);
        let ce = ce.max(cs).min(line_cols.saturating_sub(1).max(cs));
        // inclusive end col → exclusive visual end
        let b0 = visual_col_to_byte(&t, cs);
        let b1 = if ce + 1 >= line_cols {
            t.len()
        } else {
            visual_col_to_byte(&t, ce + 1)
        };
        let slice = safe_str_slice(&t, b0, b1).trim_end().to_string();
        lines.push(slice);
    }
    while lines.first().map(|s| s.is_empty()).unwrap_or(false) {
        lines.remove(0);
    }
    while lines.last().map(|s| s.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    lines.join("\n")
}

pub fn point_in_rect(col: u16, row: u16, r: ratatui::layout::Rect) -> bool {
    col >= r.x
        && col < r.x.saturating_add(r.width)
        && row >= r.y
        && row < r.y.saturating_add(r.height)
}

pub fn visual_col_to_byte(s: &str, visual_col: usize) -> usize {
    let mut col = 0usize;
    for (i, ch) in s.char_indices() {
        let w = UnicodeWidthChar::width(ch).unwrap_or(1);
        if col + w > visual_col {
            return i;
        }
        col += w;
    }
    s.len()
}

pub fn byte_to_visual_col(s: &str, byte: usize) -> usize {
    // 半码点下标不能 return 0（会把光标/选区打到行首）；向下 snap 到合法边界
    let byte = snap_char_boundary(s, byte.min(s.len()));
    UnicodeWidthStr::width(&s[..byte])
}

pub fn word_bounds(s: &str, byte: usize) -> (usize, usize) {
    let byte = byte.min(s.len());
    if s.is_empty() {
        return (0, 0);
    }
    let mut i = byte;
    if i == s.len() && i > 0 {
        i = prev_boundary(s, i);
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    let chars: Vec<(usize, char)> = s.char_indices().collect();
    if chars.is_empty() {
        return (0, 0);
    }
    let mut idx = chars
        .iter()
        .position(|(off, _)| *off >= i)
        .unwrap_or(chars.len().saturating_sub(1));
    if idx >= chars.len() {
        idx = chars.len() - 1;
    }
    let is_word = |c: char| c.is_alphanumeric() || c == '_' || (c as u32) > 0x7f;
    if !is_word(chars[idx].1) {
        let start = chars[idx].0;
        let end = chars.get(idx + 1).map(|x| x.0).unwrap_or(s.len());
        return (start, end);
    }
    let mut lo = idx;
    let mut hi = idx;
    while lo > 0 && is_word(chars[lo - 1].1) {
        lo -= 1;
    }
    while hi + 1 < chars.len() && is_word(chars[hi + 1].1) {
        hi += 1;
    }
    let start = chars[lo].0;
    let end = chars.get(hi + 1).map(|x| x.0).unwrap_or(s.len());
    (start, end)
}

pub(crate) fn prev_boundary(s: &str, idx: usize) -> usize {
    let mut i = idx.saturating_sub(1);
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

pub(crate) fn snap_boundary(s: &str, i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    let mut i = i;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Map input (line, visual col) → byte index (same rules as mouse click).
pub fn input_visual_to_byte(input: &str, line_off: usize, visual_col: usize) -> usize {
    let mut line_start = 0usize;
    let mut cur_line = 0usize;
    let bytes = input.as_bytes();
    while cur_line < line_off && line_start < input.len() {
        if bytes[line_start] == b'\n' {
            cur_line += 1;
        }
        line_start += 1;
        while line_start < input.len() && !input.is_char_boundary(line_start) {
            line_start += 1;
        }
    }
    line_start = snap_char_boundary(input, line_start);
    let rest = &input[line_start..];
    let line_end = rest
        .find('\n')
        .map(|i| line_start + i)
        .unwrap_or(input.len());
    let line_end = snap_char_boundary(input, line_end);
    let line = &input[line_start..line_end];
    let off = visual_col_to_byte(line, visual_col);
    snap_char_boundary(input, line_start + off)
}
pub fn content_top_y(scroll_len: usize, max_scroll: usize, from_bottom: usize) -> i64 {
    let from_bottom = from_bottom.min(max_scroll);
    let body_visible = scroll_len.saturating_sub(from_bottom);
    // start index of visible window
    let start = body_visible.saturating_sub(
        // approximate: we don't know body_h here; caller should pass start
        0,
    );
    let _ = start;
    // actual: content_top = start of visible = end - body_h
    // contentTopY in Ink = maxScroll - offset, where offset=fromBottom
    // When offset=0, contentTopY=maxScroll, bottom of content at viewport bottom.
    // Our scroll_plain[0] is top of content (oldest). Visible starts at:
    // start = len - from_bottom - body_h ... handled by caller with start index.
    (max_scroll.saturating_sub(from_bottom)) as i64
}

pub fn screen_to_abs_y(
    screen_row: u16,
    chat_inner_y: u16,
    visible_start: usize,
) -> Option<i64> {
    if screen_row < chat_inner_y {
        return None;
    }
    let off = (screen_row - chat_inner_y) as usize;
    Some((visible_start + off) as i64)
}

/// Public pure extract for chat fixtures (tests call shipped path).
pub fn extract_chat_public(c: &ChatSel, scroll_plain: &[String]) -> String {
    extract_chat(c, scroll_plain)
}

/// Ink `resolveMode`: input → chat → global by press start point.
pub fn resolve_sel_mode(
    col: u16,
    row: u16,
    chat_inner: ratatui::layout::Rect,
    input_rect: ratatui::layout::Rect,
) -> SelMode {
    if point_in_rect(col, row, input_rect) {
        return SelMode::Input;
    }
    if point_in_rect(col, row, chat_inner) {
        return SelMode::Chat;
    }
    SelMode::Global
}

/// Visual word bounds on a plain chat line (cols relative to line start, inclusive end).
pub fn plain_word_visual_cols(text: &str, visual_col: usize) -> (u16, u16) {
    let b = visual_col_to_byte(text, visual_col);
    let (a, z) = word_bounds(text, b);
    let c0 = byte_to_visual_col(text, a) as u16;
    let c1 = byte_to_visual_col(text, z).saturating_sub(1) as u16;
    (c0, c1.max(c0))
}

/// Full non-empty visual span of a plain line (inclusive end col).
pub fn plain_line_visual_cols(text: &str) -> (u16, u16) {
    let w = UnicodeWidthStr::width(text);
    if w == 0 {
        return (0, 0);
    }
    // trim trailing spaces for end (Ink findLineBoundaries trims)
    let trimmed = text.trim_end();
    let end = UnicodeWidthStr::width(trimmed).saturating_sub(1) as u16;
    // 前导空白字节数：trim_start 在 char 边界；再 snap 更稳
    let start_trim = text.len() - text.trim_start().len();
    let bi = snap_char_boundary(text, start_trim.min(text.len()));
    let lead = &text[..bi];
    let start = UnicodeWidthStr::width(lead) as u16;
    (start.min(end), end)
}

pub(crate) fn char_class(ch: char) -> u8 {
    if ch.is_ascii_alphanumeric() || ch == '_' {
        1 // word
    } else if (ch as u32) >= 0x4e00 {
        2 // cjk-ish
    } else if ch.is_whitespace() {
        0
    } else {
        3 // other
    }
}

/// Ink findWordAt on VRAM row (0-based screen coords, inclusive end col).
pub fn vram_word_bounds(vram: &crate::vram::Vram, row: u16, col: u16) -> (u16, u16) {
    if vram.cols == 0 || vram.rows == 0 || row >= vram.rows {
        return (col, col);
    }
    let col = col.min(vram.cols.saturating_sub(1));
    let ch = vram
        .cell(col, row)
        .map(|c| c.ch.chars().next().unwrap_or(' '))
        .unwrap_or(' ');
    let class = char_class(ch);
    if class == 0 || class == 3 {
        return (col, col);
    }
    let mut start = col;
    while start > 0 {
        let prev = start - 1;
        if let Some(c) = vram.cell(prev, row) {
            if c.w == 0 {
                start = prev;
                continue;
            }
            let pch = c.ch.chars().next().unwrap_or(' ');
            if char_class(pch) != class {
                break;
            }
            start = prev;
        } else {
            break;
        }
    }
    let mut end = col;
    while end + 1 < vram.cols {
        let next = end + 1;
        if let Some(c) = vram.cell(next, row) {
            if c.w == 0 {
                end = next;
                continue;
            }
            let nch = c.ch.chars().next().unwrap_or(' ');
            if char_class(nch) != class {
                break;
            }
            end = next;
        } else {
            break;
        }
    }
    (start, end)
}

/// Ink findLineBoundaries on VRAM row (trim spaces; inclusive end).
pub fn vram_line_bounds(vram: &crate::vram::Vram, row: u16) -> (u16, u16) {
    if vram.cols == 0 || row >= vram.rows {
        return (0, 0);
    }
    let mut start = 0u16;
    while start < vram.cols {
        if let Some(c) = vram.cell(start, row) {
            if c.w == 0 || c.ch.trim().is_empty() {
                start += 1;
                continue;
            }
            break;
        }
        break;
    }
    let mut end = vram.cols.saturating_sub(1);
    while end > start {
        if let Some(c) = vram.cell(end, row) {
            if c.w == 0 || c.ch.trim().is_empty() {
                end = end.saturating_sub(1);
                continue;
            }
            break;
        }
        break;
    }
    if start >= vram.cols {
        return (0, 0);
    }
    (start, end.max(start))
}

/// Ink toastCopy wording builder (no side effects). Empty/whitespace → None.
pub fn format_copy_toast(text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    let n = text.chars().count();
    let preview: String = text
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let preview: String = preview.chars().take(24).collect();
    Some(if n > 24 {
        format!("已复制 {n} 字「{preview}…」")
    } else {
        format!("已复制 {n} 字")
    })
}

/// Ink copyScreenDump / store screenshot toast:
/// `已复制整屏 ${chars} 字（${lines} 行）· 可粘贴发给 AI`
pub fn format_screen_dump_toast(text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    let chars = text.chars().count();
    let lines = text.split('\n').count().max(1);
    Some(format!(
        "已复制整屏 {chars} 字（{lines} 行）· 可粘贴发给 AI"
    ))
}

/// Ink wheel routing priority (non-drag).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WheelTarget {
    FullEditor,
    Overlay,
    EventBlockExpanded,
    Completion,
    InputHistory,
    Chat,
}

/// Pure wheel target resolve (Ink useMouseInput order without drag).
pub fn resolve_wheel_target(
    full_editor: bool,
    has_overlay: bool,
    event_block_expanded: bool,
    over_completion: bool,
    over_input: bool,
) -> WheelTarget {
    if full_editor {
        return WheelTarget::FullEditor;
    }
    if has_overlay {
        return WheelTarget::Overlay;
    }
    if event_block_expanded {
        return WheelTarget::EventBlockExpanded;
    }
    if over_completion {
        return WheelTarget::Completion;
    }
    if over_input {
        return WheelTarget::InputHistory;
    }
    WheelTarget::Chat
}

/// Ink: `fullEditorInitial !== null` preempts overlay hit rects for all mouse routing.
/// Stale `overlay_rect` from a previous frame must not steal wheel/click while full editor is open.
pub fn mouse_preempts_overlay(full_editor: bool) -> bool {
    full_editor
}

/// Snap `i` down to a valid UTF-8 char boundary (never mid-codepoint).
pub fn snap_char_boundary(text: &str, mut i: usize) -> usize {
    i = i.min(text.len());
    while i > 0 && !text.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Safe substring [a, b) with both ends snapped to char boundaries (never panics).
pub fn safe_str_slice(s: &str, a: usize, b: usize) -> &str {
    let mut a = snap_char_boundary(s, a.min(s.len()));
    let mut b = snap_char_boundary(s, b.min(s.len()));
    if a > b {
        std::mem::swap(&mut a, &mut b);
    }
    // after swap both still boundaries
    &s[a..b]
}

/// Byte offset within `line` for the `col_cp`-th Unicode scalar (Ink TextArea code-point col).
/// Clamps past end of line to `line.len()`. Always a char boundary.
pub fn byte_at_codepoint_col(line: &str, col_cp: usize) -> usize {
    let mut n = 0usize;
    for (i, _) in line.char_indices() {
        if n == col_cp {
            return i;
        }
        n += 1;
    }
    line.len()
}

/// Shift byte cursor by ±1 line preserving **code-point column** (Ink `indexToCursorPos` /
/// TextArea), never landing mid-UTF-8. Used by full-editor wheel and multi-line draft ↑↓.
pub fn shift_cursor_line(text: &str, cursor: usize, dir_up: bool) -> usize {
    let cursor = snap_char_boundary(text, cursor);
    if text.is_empty() {
        return 0;
    }
    let line_start = text[..cursor].rfind('\n').map(|i| i + 1).unwrap_or(0);
    // Ink: col = [...line.slice(0, cursor)].length  (code points, not bytes / display width)
    let col_cp = text[line_start..cursor].chars().count();
    if dir_up {
        if line_start == 0 {
            return 0;
        }
        let prev_end = line_start - 1; // index of '\n'
        let prev_start = text[..prev_end].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let prev_line = &text[prev_start..prev_end];
        let off = byte_at_codepoint_col(prev_line, col_cp);
        debug_assert!(text.is_char_boundary(prev_start + off));
        prev_start + off
    } else {
        let rest = &text[cursor..];
        if let Some(rel) = rest.find('\n') {
            let next_start = cursor + rel + 1;
            let next_rest = &text[next_start..];
            let next_end = next_rest
                .find('\n')
                .map(|i| next_start + i)
                .unwrap_or(text.len());
            let next_line = &text[next_start..next_end];
            let off = byte_at_codepoint_col(next_line, col_cp);
            debug_assert!(text.is_char_boundary(next_start + off));
            next_start + off
        } else {
            text.len()
        }
    }
}

pub fn pin_chat_edge_abs_y(
    dir: i8,
    content_top_y: i64,
    chat_height: u16,
) -> i64 {
    if dir < 0 {
        content_top_y
    } else {
        content_top_y + (chat_height.saturating_sub(1) as i64)
    }
}
