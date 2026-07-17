//! App shell: state + event handlers + draw (split by concern).

mod draw;
pub(crate) mod input_paint;
mod keys;
mod mouse_handlers;
mod protocol_io;
mod state;
mod text_util;

#[cfg(test)]
mod edit_safety_tests;

#[allow(unused_imports)]
pub use input_paint::{
    input_height, input_lines_plain, input_view_start, paint_input_lines_ink,
};
pub use protocol_io::{poll_events, spawn_protocol_reader};

use crate::messages;
use crate::mouse::SelController;
use crate::protocol::*;
use crate::theme::Theme;
use crate::vram::Vram;
use ratatui::layout::Rect;
use std::collections::{HashSet, VecDeque};
use std::sync::mpsc::Receiver;
use std::time::Instant;

pub(crate) struct LocalToast {
    pub text: String,
    pub kind: String,
    pub until: Instant,
}

pub struct App {
    pub product: String,
    pub model: String,
    pub agent: String,
    pub cwd: String,
    pub status: String,
    pub streaming: bool,
    pub messages: Vec<UiMessage>,
    pub system_events: Vec<ProtoSystemEvent>,
    pub chrome: ProtoChrome,
    pub theme: Theme,
    pub overlay: Option<ProtoOverlay>,
    pub overlay_sel: usize,
    /// First visible item index in SelectList window (for mouse hit → absolute index).
    pub(crate) overlay_list_from: usize,
    /// Number of item rows currently painted in the overlay window.
    pub(crate) overlay_list_count: usize,
    /// Mouse hover row in overlay list (highlight only; Ink SelectList).
    pub(crate) overlay_hover: Option<usize>,
    /// Scroll offset for lines-only overlays (help / prompt dump).
    pub(crate) overlay_scroll: usize,
    pub completions: Option<ProtoCompletions>,
    pub terminal_approval: Option<ProtoTerminalApproval>,
    pub gallery_lines: Vec<String>,
    pub input: String,
    pub cursor: usize,
    /// Manual first-visible line of multi-line input (wheel / drag-scroll); None = pin to caret.
    pub(crate) input_view_offset: Option<usize>,
    pub scroll_from_bottom: u16,
    /// Ink `autoFollow`: pin to latest while true; leave on scroll-up, re-enter at bottom.
    /// When false, stream growth uses pin-content (from_bottom += Δ) so the view is not sucked down.
    pub(crate) auto_follow: bool,
    /// After send while following: keep a larger tail pad until stream settles
    /// (Ink BOTTOM_PAD + room for AI growth; Grok follow-at-bottom).
    pub(crate) follow_tail_boost: bool,
    /// Recent wheel burst count（Grok 式步长 1/2/4 用）。
    pub(crate) wheel_burst: u8,
    pub(crate) wheel_last_at: Instant,
    /// 触控板分数累加（不足 1 行先攒，对齐 Grok trackpad accumulation）
    pub(crate) wheel_frac: f32,
    pub should_quit: bool,
    pub fps: f32,
    pub full_editor: bool,
    pub full_editor_text: String,
    pub(crate) full_editor_cursor: usize,
    /// Inner rect of full-screen editor body (for mouse caret placement).
    pub(crate) full_editor_rect: Option<Rect>,
    pub(crate) event_rect: Option<Rect>,
    pub(crate) frame_times: VecDeque<Instant>,
    pub(crate) ctrl_c_armed: bool,
    pub(crate) ctrl_c_at: Instant,
    pub(crate) last_input_emit: Instant,
    /// Software caret blink phase (Ink notifyCursorActivity / isCursorBlinkVisible)
    pub(crate) caret_blink_on: bool,
    pub(crate) caret_blink_at: Instant,
    pub(crate) tool_hits: Vec<messages::ToolHit>,
    pub(crate) msg_expand_hits: Vec<messages::ExpandHit>,
    pub(crate) thinking_hits: Vec<messages::ThinkingHit>,
    pub(crate) system_event_hits: Vec<messages::SystemEventHit>,
    /// Ink SystemEventRow local `open` set (detail expand).
    pub(crate) expanded_system_events: HashSet<String>,
    pub(crate) spinner_frame: u64,
    pub(crate) back_to_bottom_y: Option<u16>,
    pub(crate) jump_prev_y: Option<u16>,
    pub(crate) goal_rect: Option<Rect>,
    pub(crate) chat_rect: Rect,
    pub(crate) chat_inner: Rect,
    pub(crate) input_rect: Rect,
    pub(crate) nav_rect: Rect,
    pub(crate) completion_rect: Option<Rect>,
    pub(crate) overlay_rect: Option<Rect>,
    /// Terminal approval bar rect for mouse hit (Y/A/N/B).
    pub(crate) approval_rect: Option<Rect>,
    /// Hovered approval chip: "y"|"a"|"n"|"b" (Ink TerminalApprovalBar hover).
    pub(crate) approval_hover: Option<String>,
    /// Paint-time chip hit boxes: (x0, x1 exclusive, choice) on approval row 0.
    pub(crate) approval_chips: Vec<(u16, u16, String)>,
    /// (x0, x1, id, action_kind, action_value)
    pub(crate) nav_segs: Vec<(u16, u16, String, String, String)>,
    /// Ink EventBlockExpanded vertical scroll (0 = top of supervisor log).
    pub(crate) event_expand_scroll: u16,
    /// Tool result/diff fully expanded (Ink DiffCollapsible open).
    pub(crate) expanded_tool_results: HashSet<String>,
    pub(crate) tool_result_hits: Vec<messages::ToolResultHit>,
    pub(crate) chat_line_cache: Vec<(u16, String, u16)>,
    pub(crate) scroll_plain: Vec<String>,
    pub(crate) visible_start: usize,
    /// Cache of full scroll document (lines + hits) to avoid re-markdown every frame.
    pub(crate) scroll_render_cache:
        Option<(String, usize, Vec<ratatui::text::Line<'static>>, messages::RenderHits)>,
    pub(crate) sel: SelController,
    pub(crate) hover_id: Option<String>,
    pub(crate) last_edge_tick: Instant,
    pub(crate) max_scroll_lines: usize,
    /// InfoBar 右侧模型名 hit 区（点击打开 model overlay）
    pub(crate) model_hit: Option<Rect>,
    pub vram: Vram,
    pub(crate) local_toast: Option<LocalToast>,
    pub(crate) rx: Receiver<InMsg>,
    /// Ink terminal-viewport overflowLatch (IME lateral scroll).
    pub(crate) viewport_overflow_latch: bool,
    /// Set when latch clears → main loop restores viewport once.
    pub(crate) need_viewport_restore: bool,
    /// Next frame: Terminal::clear + full paint (diff buffer desync / blank regions).
    pub(crate) need_full_redraw: bool,
    /// Last frame size (for IME pin clamp).
    pub(crate) screen_cols: u16,
    pub(crate) screen_rows: u16,
}

impl App {
    pub fn new(rx: Receiver<InMsg>) -> Self {
        Self {
            product: "coding".into(),
            model: "—".into(),
            agent: "main".into(),
            cwd: String::new(),
            status: "IDLE".into(),
            streaming: false,
            messages: vec![],
            system_events: vec![],
            chrome: ProtoChrome::default(),
            theme: Theme::default(),
            overlay: None,
            overlay_sel: 0,
            overlay_list_from: 0,
            overlay_list_count: 0,
            overlay_hover: None,
            overlay_scroll: 0,
            completions: None,
            terminal_approval: None,
            gallery_lines: vec![],
            input: String::new(),
            cursor: 0,
            input_view_offset: None,
            scroll_from_bottom: 0,
            auto_follow: true,
            follow_tail_boost: false,
            wheel_burst: 0,
            wheel_last_at: Instant::now(),
            wheel_frac: 0.0,
            should_quit: false,
            fps: 0.0,
            full_editor: false,
            full_editor_text: String::new(),
            full_editor_cursor: 0,
            full_editor_rect: None,
            event_rect: None,
            frame_times: VecDeque::with_capacity(64),
            ctrl_c_armed: false,
            ctrl_c_at: Instant::now(),
            last_input_emit: Instant::now(),
            caret_blink_on: true,
            caret_blink_at: Instant::now(),
            tool_hits: vec![],
            msg_expand_hits: vec![],
            thinking_hits: vec![],
            system_event_hits: vec![],
            expanded_system_events: HashSet::new(),
            spinner_frame: 0,
            back_to_bottom_y: None,
            jump_prev_y: None,
            goal_rect: None,
            chat_rect: Rect::default(),
            chat_inner: Rect::default(),
            input_rect: Rect::default(),
            nav_rect: Rect::default(),
            completion_rect: None,
            overlay_rect: None,
            approval_rect: None,
            approval_hover: None,
            approval_chips: vec![],
            nav_segs: vec![],
            event_expand_scroll: 0,
            expanded_tool_results: HashSet::new(),
            tool_result_hits: vec![],
            chat_line_cache: vec![],
            scroll_plain: vec![],
            visible_start: 0,
            scroll_render_cache: None,
            sel: SelController::default(),
            hover_id: None,
            last_edge_tick: Instant::now(),
            max_scroll_lines: 0,
            model_hit: None,
            vram: Vram::empty(),
            local_toast: None,
            rx,
            viewport_overflow_latch: false,
            need_viewport_restore: false,
            need_full_redraw: true, // first frame always full
            screen_cols: 80,
            screen_rows: 24,
        }
    }

    /// Request a full terminal redraw (clear previous buffer + repaint).
    /// Cheap one-frame cost; use after send / overlay / layout-heavy state swaps.
    pub fn request_full_redraw(&mut self) {
        self.need_full_redraw = true;
    }

    /// Consume full-redraw flag (main loop).
    pub fn take_full_redraw(&mut self) -> bool {
        if self.need_full_redraw {
            self.need_full_redraw = false;
            true
        } else {
            false
        }
    }

    /// 是否需要把本帧 buffer 拷进 VRAM（全局选区 / 拖选 / Ctrl+G 前）。
    /// 滚动热路径跳过可省一整屏 cell 扫描。
    pub fn needs_vram_capture(&self) -> bool {
        self.sel.needs_vram()
    }

    /// Display columns available for input draft body (after prompt). Soft-wrap uses this.
    pub(crate) fn input_body_width(&self) -> usize {
        use crate::mouse;
        let prompt_w = mouse::prompt_cols() as usize;
        let w = if self.input_rect.width > 0 {
            self.input_rect.width as usize
        } else {
            self.screen_cols.max(8) as usize
        };
        w.saturating_sub(prompt_w).max(4)
    }

    /// Display-row count of current draft (hard `\n` + soft wrap).
    pub(crate) fn input_display_line_count(&self) -> usize {
        use input_paint::input_display_rows;
        input_display_rows(&self.input, self.input_body_width())
            .len()
            .max(1)
    }

    /// 0-based (col, row) for hidden HW cursor pin after paint (I02).
    pub fn ime_pin_pos(&self) -> Option<(u16, u16)> {
        use crate::mouse;
        use input_paint::input_view_start_with_offset;
        use text_util::caret_screen_pos;

        if self.full_editor {
            let r = self.full_editor_rect?;
            return caret_screen_pos(
                &self.full_editor_text,
                self.full_editor_cursor,
                r.x,
                r.y,
                r.width,
                r.height,
                r.x,
                0,
                self.screen_cols,
                self.screen_rows,
                usize::MAX / 4,
            );
        }
        // Overlay / approval: still pin to input so IME does not wander
        let r = self.input_rect;
        if r.width == 0 || r.height == 0 {
            return None;
        }
        let prompt_w = mouse::prompt_cols();
        let origin_x = r.x.saturating_add(prompt_w);
        let body_w = self.input_body_width();
        let vs = input_view_start_with_offset(
            &self.input,
            self.cursor,
            self.input_view_offset,
            body_w,
        );
        caret_screen_pos(
            &self.input,
            self.cursor,
            r.x,
            r.y,
            r.width,
            r.height,
            origin_x,
            vs,
            self.screen_cols,
            self.screen_rows,
            body_w,
        )
    }

    /// Update IME overflow latch from current draft (I03 / noteInputContentWidth).
    pub fn update_viewport_overflow(&mut self) {
        use crate::mouse;
        use text_util::{caret_raw_col_overflows, max_line_visual_width};

        let (text, cursor, origin_x, content_cols) = if self.full_editor {
            let r = match self.full_editor_rect {
                Some(r) => r,
                None => return,
            };
            (
                self.full_editor_text.as_str(),
                self.full_editor_cursor,
                r.x,
                r.width.max(8),
            )
        } else {
            let r = self.input_rect;
            let prompt_w = mouse::prompt_cols();
            let origin = r.x.saturating_add(prompt_w);
            let content = r.width.saturating_sub(prompt_w).max(8);
            (self.input.as_str(), self.cursor, origin, content)
        };

        let wide = max_line_visual_width(text) > content_cols as usize
            || caret_raw_col_overflows(text, cursor, origin_x, self.screen_cols);

        if wide {
            self.viewport_overflow_latch = true;
        } else if self.viewport_overflow_latch {
            self.viewport_overflow_latch = false;
            self.need_viewport_restore = true;
        }
    }

    /// Take one-shot viewport restore request (Ink restoreTerminalViewport).
    pub fn take_viewport_restore(&mut self) -> bool {
        if self.need_viewport_restore {
            self.need_viewport_restore = false;
            true
        } else {
            false
        }
    }
}
