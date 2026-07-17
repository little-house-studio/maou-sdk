//! Selection types, modes, phases, click tracker.

use ratatui::style::Color;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Ink SEL_BG_RGB #2121FF —— Tau Ceti 计算机蓝，选区唯一底色（无渐变）
pub const SEL_BG: Color = Color::Rgb(0x21, 0x21, 0xff);
/// Ink SEL_FG_SGR #EBEBEB —— 计算机蓝底上的浅字
pub const SEL_FG: Color = Color::Rgb(0xEB, 0xEB, 0xEB);
/// Flash phase (sel-fx.ts)
pub const SEL_FLASH_BG: Color = Color::Rgb(220, 220, 220);
pub const SEL_FLASH_FG: Color = Color::Rgb(20, 20, 20);

pub const FLASH_MS: u64 = 50;
/// Input: don't open selection until drag exceeds this (avoid second cursor)
pub const INPUT_DRAG_THRESHOLD: u16 = 1;
/// Ink DOUBLE_CLICK_MS / DOUBLE_CLICK_DIST (manhattan)
pub const DOUBLE_CLICK_MS: u64 = 400;
pub const DOUBLE_CLICK_DIST: u16 = 3;
/// Ink EDGE_ZONE rows at chat top/bottom
pub const EDGE_ZONE: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellPos {
    pub row: u16,
    pub col: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelMode {
    Chat,
    Global,
    Input,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelPhase {
    None,
    Live,
    Flash,
    Settled,
}

/// Chat selection: absY is content line index (0 = oldest in scroll_plain).
#[derive(Debug, Clone)]
pub struct ChatSel {
    pub a_y: i64,
    pub a_col: u16,
    pub b_y: i64,
    pub b_col: u16,
    /// absY → full line text (collected while scrolling/dragging)
    pub line_cache: HashMap<i64, String>,
}

#[derive(Debug, Clone)]
pub struct GlobalSel {
    pub a: CellPos,
    pub b: CellPos,
}

#[derive(Debug, Clone)]
pub struct InputSel {
    pub start_byte: usize,
    pub end_byte: usize,
}

#[derive(Debug, Clone)]
pub enum ActiveSel {
    Chat(ChatSel),
    Global(GlobalSel),
    Input(InputSel),
}

#[derive(Debug, Clone)]
pub struct DragState {
    pub mode: SelMode,
    pub start: CellPos,
    pub end: CellPos,
    pub moved: bool,
    pub click_count: u8,
    /// Ink wordMode: double-click drag snaps end to word edge
    pub word_mode: bool,
    pub edge_dir: Option<i8>,
    /// Chat: absY at press
    pub start_abs_y: i64,
    /// Input: byte at press
    pub start_byte: usize,
}

#[derive(Debug, Default)]
pub struct ClickTracker {
    last_time: Option<Instant>,
    last_col: u16,
    last_row: u16,
    count: u8,
}

impl ClickTracker {
    /// Ink: now-last < 400ms && manhattan dist < 3 → count+1 (cap 3)
    pub fn register(&mut self, col: u16, row: u16) -> u8 {
        let now = Instant::now();
        let dist = col.abs_diff(self.last_col) + row.abs_diff(self.last_row);
        let multi = if let Some(t) = self.last_time {
            now.duration_since(t) < Duration::from_millis(DOUBLE_CLICK_MS)
                && dist < DOUBLE_CLICK_DIST
        } else {
            false
        };
        if multi {
            self.count = (self.count % 3) + 1;
        } else {
            self.count = 1;
        }
        self.last_time = Some(now);
        self.last_col = col;
        self.last_row = row;
        self.count
    }
}

