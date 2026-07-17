//! SelController: active selection, extract, overlay paint, phases.

use super::helpers::{
    extract_chat, input_visual_to_byte, normalize_abs, normalize_cell, safe_str_slice,
    sel_cell_style, sel_style_colors,
};
use super::types::*;
use crate::vram::Vram;
use ratatui::style::{Modifier, Style};
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Full selection controller (paint + extract + phase).
pub struct SelController {
    pub active: Option<ActiveSel>,
    pub phase: SelPhase,
    pub drag: Option<DragState>,
    flash_until: Option<Instant>,
    clicks: ClickTracker,
    /// sticky line cache (Shift-style survival across clears of thin sels)
    sticky: HashMap<i64, String>,
    /// Last chat selection anchor for Shift+click extend (Ink sticky)
    pub last_chat_anchor: Option<(i64, u16)>,
    /// Last global selection anchor for Shift+click extend
    pub last_global_anchor: Option<CellPos>,
}

impl Default for SelController {
    fn default() -> Self {
        Self {
            active: None,
            phase: SelPhase::None,
            drag: None,
            flash_until: None,
            clicks: ClickTracker::default(),
            sticky: HashMap::new(),
            last_chat_anchor: None,
            last_global_anchor: None,
        }
    }
}

impl SelController {
    /// True when global/chat drag needs the screen cell buffer (skip capture while idle/scroll).
    pub fn needs_vram(&self) -> bool {
        if self.drag.is_some() {
            return true;
        }
        matches!(
            self.active,
            Some(ActiveSel::Global(_)) | Some(ActiveSel::Chat(_))
        ) && self.phase != SelPhase::None
    }

    pub fn clear(&mut self) {
        self.active = None;
        self.phase = SelPhase::None;
        self.drag = None;
        self.flash_until = None;
    }

    pub fn tick_phase(&mut self) {
        if self.phase == SelPhase::Flash {
            if let Some(t) = self.flash_until {
                if Instant::now() >= t {
                    self.phase = SelPhase::Settled;
                    self.flash_until = None;
                }
            }
        }
    }

    pub fn register_click(&mut self, col: u16, row: u16) -> u8 {
        self.clicks.register(col, row)
    }

    pub fn live(&mut self) {
        self.phase = SelPhase::Live;
        self.flash_until = None;
    }

    /// Mouse up after meaningful selection: flash → settled, return text to copy.
    /// `lite`: skip flash, settle immediately (Ink isLiteNoSelFx).
    pub fn release_and_extract(
        &mut self,
        scroll_plain: &[String],
        chat_cache: &[(u16, String, u16)],
        content_top_y: i64,
        input: &str,
        vram: &crate::vram::Vram,
    ) -> String {
        self.release_and_extract_opts(
            scroll_plain,
            chat_cache,
            content_top_y,
            input,
            vram,
            false,
        )
    }

    pub fn release_and_extract_opts(
        &mut self,
        scroll_plain: &[String],
        chat_cache: &[(u16, String, u16)],
        content_top_y: i64,
        input: &str,
        vram: &crate::vram::Vram,
        lite: bool,
    ) -> String {
        // Remember anchors for next Shift+click (Ink sticky)
        match &self.active {
            Some(ActiveSel::Chat(c)) => {
                self.last_chat_anchor = Some((c.a_y, c.a_col));
            }
            Some(ActiveSel::Global(g)) => {
                self.last_global_anchor = Some(g.a);
            }
            _ => {}
        }
        let text = self.extract(scroll_plain, chat_cache, content_top_y, input, vram);
        if self.active.is_some() {
            if lite {
                self.phase = SelPhase::Settled;
                self.flash_until = None;
            } else {
                self.phase = SelPhase::Flash;
                self.flash_until = Some(Instant::now() + Duration::from_millis(FLASH_MS));
            }
        }
        self.drag = None;
        text
    }

    pub fn put_line_cache(&mut self, abs_y: i64, text: String) {
        if text.contains("回到最底部") {
            return;
        }
        self.sticky.insert(abs_y, text.clone());
        if let Some(ActiveSel::Chat(c)) = &mut self.active {
            c.line_cache.insert(abs_y, text);
        }
    }

    /// Capture all currently visible chat lines into cache (fill holes).
    pub fn capture_visible(
        &mut self,
        chat_cache: &[(u16, String, u16)],
        content_top_y: i64,
        chat_inner_y: u16,
    ) {
        for (row, text, _) in chat_cache {
            let abs = content_top_y + (*row as i64 - chat_inner_y as i64);
            if abs >= 0 {
                self.put_line_cache(abs, text.clone());
            }
        }
    }

    pub fn start_chat(&mut self, abs_y: i64, col: u16, scroll_plain: &[String]) {
        self.start_chat_opts(abs_y, col, scroll_plain, false);
    }

    /// `extend`: Ink Shift+click — keep previous anchor (active or last_chat_anchor).
    pub fn start_chat_opts(
        &mut self,
        abs_y: i64,
        col: u16,
        scroll_plain: &[String],
        extend: bool,
    ) {
        let (a_y, a_col) = if extend {
            if let Some(ActiveSel::Chat(c)) = &self.active {
                (c.a_y, c.a_col)
            } else if let Some(a) = self.last_chat_anchor {
                a
            } else {
                (abs_y, col)
            }
        } else {
            (abs_y, col)
        };
        let mut cache = HashMap::new();
        for y in [a_y, abs_y] {
            if let Some(t) = scroll_plain.get(y as usize) {
                cache.insert(y, t.clone());
                self.sticky.insert(y, t.clone());
            }
        }
        for (k, v) in &self.sticky {
            cache.entry(*k).or_insert_with(|| v.clone());
        }
        self.active = Some(ActiveSel::Chat(ChatSel {
            a_y,
            a_col,
            b_y: abs_y,
            b_col: col,
            line_cache: cache,
        }));
        self.last_chat_anchor = Some((a_y, a_col));
        self.live();
    }

    pub fn update_chat_end(&mut self, abs_y: i64, col: u16, scroll_plain: &[String]) {
        if let Some(ActiveSel::Chat(c)) = &mut self.active {
            c.b_y = abs_y;
            c.b_col = col;
            if let Some(t) = scroll_plain.get(abs_y as usize) {
                c.line_cache.insert(abs_y, t.clone());
            }
            // fill range holes from sticky / plain
            let (y1, y2) = if c.a_y <= c.b_y {
                (c.a_y, c.b_y)
            } else {
                (c.b_y, c.a_y)
            };
            for y in y1..=y2 {
                if !c.line_cache.contains_key(&y) {
                    if let Some(t) = scroll_plain.get(y as usize) {
                        c.line_cache.insert(y, t.clone());
                    } else if let Some(t) = self.sticky.get(&y) {
                        c.line_cache.insert(y, t.clone());
                    }
                }
            }
        }
        self.live();
    }

    pub fn start_global(&mut self, row: u16, col: u16) {
        self.start_global_opts(row, col, false);
    }

    pub fn start_global_opts(&mut self, row: u16, col: u16, extend: bool) {
        let a = if extend {
            if let Some(ActiveSel::Global(g)) = &self.active {
                g.a
            } else if let Some(a) = self.last_global_anchor {
                a
            } else {
                CellPos { row, col }
            }
        } else {
            CellPos { row, col }
        };
        let b = CellPos { row, col };
        self.active = Some(ActiveSel::Global(GlobalSel { a, b }));
        self.last_global_anchor = Some(a);
        self.live();
    }

    pub fn update_global_end(&mut self, row: u16, col: u16) {
        if let Some(ActiveSel::Global(g)) = &mut self.active {
            g.b = CellPos { row, col };
        }
        self.live();
    }

    pub fn start_input(&mut self, byte: usize) {
        // no visual until drag — but store range equal
        self.active = Some(ActiveSel::Input(InputSel {
            start_byte: byte,
            end_byte: byte,
        }));
        self.phase = SelPhase::None; // no blue zero-width
    }

    pub fn update_input_end(&mut self, byte: usize) {
        if let Some(ActiveSel::Input(i)) = &mut self.active {
            i.end_byte = byte;
            if i.start_byte != i.end_byte {
                self.live();
            }
        }
    }

    pub fn extract(
        &self,
        scroll_plain: &[String],
        _chat_cache: &[(u16, String, u16)],
        _content_top_y: i64,
        input: &str,
        vram: &crate::vram::Vram,
    ) -> String {
        match &self.active {
            // ① 上下文内容：lineCache / scroll_plain（内容锚定）
            Some(ActiveSel::Chat(c)) => extract_chat(c, scroll_plain),
            // ② 显存：从无关处开始 → 读帧缓冲格子（Ink lastGrid）
            Some(ActiveSel::Global(g)) => {
                let (a, b) = normalize_cell(g.a, g.b);
                vram.extract_region(a.row, a.col, b.row, b.col)
            }
            // ③ 输入框：草稿字符切片（不走显存，避免 ❯/CSI）
            Some(ActiveSel::Input(i)) => {
                let a = i.start_byte.min(i.end_byte).min(input.len());
                let b = i.start_byte.max(i.end_byte).min(input.len());
                // never mid-UTF-8; empty range if inverted after snap
                safe_str_slice(input, a, b).to_string()
            }
            None => String::new(),
        }
    }

    /// Chat: abs content line + relative visual col (0 = first col of line plain).
    pub fn chat_rel_selected(&self, abs_y: i64, rel_col: u16) -> bool {
        let Some(ActiveSel::Chat(c)) = &self.active else {
            return false;
        };
        if self.phase == SelPhase::None {
            return false;
        }
        let (y1, c1, y2, c2) = normalize_abs(c.a_y, c.a_col, c.b_y, c.b_col);
        if abs_y < y1 || abs_y > y2 {
            return false;
        }
        if y1 == y2 {
            return rel_col >= c1 && rel_col <= c2;
        }
        if abs_y == y1 {
            return rel_col >= c1;
        }
        if abs_y == y2 {
            return rel_col <= c2;
        }
        true
    }

    pub fn global_cell_selected(&self, row: u16, col: u16) -> bool {
        let Some(ActiveSel::Global(g)) = &self.active else {
            return false;
        };
        if self.phase == SelPhase::None {
            return false;
        }
        let (a, b) = normalize_cell(g.a, g.b);
        if row < a.row || row > b.row {
            return false;
        }
        if a.row == b.row {
            return col >= a.col && col <= b.col;
        }
        if row == a.row {
            return col >= a.col;
        }
        if row == b.row {
            return col <= b.col;
        }
        true
    }

    /// Paint selection onto ratatui buffer — same 0-based screen coords as crossterm mouse.
    /// `input_view_start` is the first logical line index shown in the input viewport (Ink TextArea).
    pub fn apply_overlay(
        &self,
        buf: &mut ratatui::buffer::Buffer,
        chat_inner: ratatui::layout::Rect,
        visible_start: usize,
        input_rect: ratatui::layout::Rect,
        input: &str,
        input_text_x0: u16,
        input_view_start: usize,
    ) {
        if self.phase == SelPhase::None || self.active.is_none() {
            return;
        }
        let area = buf.area();
        let max_w = area.width;
        let max_h = area.height;
        let cell_style = sel_cell_style(self.phase);

        match &self.active {
            Some(ActiveSel::Chat(_)) => {
                for dy in 0..chat_inner.height {
                    let y = chat_inner.y + dy;
                    if y >= max_h {
                        break;
                    }
                    let abs_y = visible_start as i64 + dy as i64;
                    for dx in 0..chat_inner.width {
                        let x = chat_inner.x + dx;
                        if x >= max_w {
                            break;
                        }
                        if self.chat_rel_selected(abs_y, dx) {
                            if let Some(cell) = buf.cell_mut((x, y)) {
                                if cell.symbol().is_empty() {
                                    continue;
                                }
                                cell.set_style(cell_style);
                            }
                        }
                    }
                }
            }
            Some(ActiveSel::Global(g)) => {
                let (a, b) = normalize_cell(g.a, g.b);
                for y in a.row..=b.row {
                    if y >= max_h {
                        break;
                    }
                    let (x0, x1) = if a.row == b.row {
                        (a.col, b.col)
                    } else if y == a.row {
                        (a.col, max_w.saturating_sub(1))
                    } else if y == b.row {
                        (0, b.col)
                    } else {
                        (0, max_w.saturating_sub(1))
                    };
                    for x in x0..=x1 {
                        if x >= max_w {
                            break;
                        }
                        if let Some(cell) = buf.cell_mut((x, y)) {
                            if cell.symbol().is_empty() {
                                continue;
                            }
                            cell.set_style(cell_style);
                        }
                    }
                }
            }
            Some(ActiveSel::Input(i)) if i.start_byte != i.end_byte => {
                let (b0, b1) = (
                    i.start_byte.min(i.end_byte),
                    i.start_byte.max(i.end_byte),
                );
                // 视口行 = soft-wrap display rows（与 paint / hit-test 一致）
                use crate::app::input_paint::{
                    display_row_visual_to_byte, input_display_rows,
                };
                let prompt_w = input_text_x0.saturating_sub(input_rect.x) as usize;
                let body_w = (input_rect.width as usize)
                    .saturating_sub(prompt_w)
                    .max(4);
                let rows = input_display_rows(input, body_w);
                let text_rows = input_rect.height.max(1);
                for dy in 0..text_rows {
                    let y = input_rect.y.saturating_add(dy);
                    if y >= max_h {
                        break;
                    }
                    let disp = input_view_start + dy as usize;
                    let x_end = input_rect.x.saturating_add(input_rect.width);
                    for x in input_text_x0..x_end {
                        if x >= max_w {
                            break;
                        }
                        let vcol = x.saturating_sub(input_text_x0) as usize;
                        let byte =
                            display_row_visual_to_byte(input, &rows, disp, vcol);
                        if byte >= b0 && byte < b1 {
                            if let Some(cell) = buf.cell_mut((x, y)) {
                                if cell.symbol().is_empty() {
                                    continue;
                                }
                                cell.set_style(cell_style);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    pub fn input_range(&self) -> Option<(usize, usize)> {
        match &self.active {
            Some(ActiveSel::Input(i)) if i.start_byte != i.end_byte => {
                Some((i.start_byte.min(i.end_byte), i.start_byte.max(i.end_byte)))
            }
            _ => None,
        }
    }

    /// True when a non-empty input draft selection is active (Ink hasTextSel).
    /// Chat or global selection present (for Cmd+C / Ctrl+Shift+C).
    pub fn has_chat_or_global_sel(&self) -> bool {
        matches!(
            &self.active,
            Some(ActiveSel::Chat(_)) | Some(ActiveSel::Global(_))
        ) && self.phase != SelPhase::None
    }

    pub fn has_input_text_sel(&self) -> bool {
        self.input_range().is_some()
    }

    pub fn sel_style(&self) -> Style {
        let (fg, bg) = sel_style_colors(self.phase);
        match self.phase {
            SelPhase::None => Style::default(),
            SelPhase::Live | SelPhase::Settled => Style::default()
                .fg(fg)
                .bg(bg)
                .add_modifier(Modifier::BOLD),
            SelPhase::Flash => Style::default().fg(fg).bg(bg),
        }
    }
}

