//! Protocol apply, toast, draft text editing, geometry helpers on App.

use super::App;
use super::LocalToast;
use super::text_util::{
    line_end, line_start, next_char_boundary, prev_char_boundary, prev_sentence_boundary,
    prev_word_boundary, scrub_input,
};
use crate::mouse::{self, osc52_copy, set_pointer_shape};
use crate::protocol::*;
use ratatui::buffer::Buffer;
use std::sync::mpsc::TryRecvError;
use std::time::{Duration, Instant};

impl App {
    pub fn capture_vram(&mut self, buf: &Buffer) {
        self.vram.capture_from_buffer(buf);
    }

    /// 对齐 Ink toastCopy：✓ 已复制 N 字「预览…」（空/空白不 toast）
    pub(crate) fn toast_copy(&mut self, text: &str) {
        let Some(msg) = mouse::format_copy_toast(text) else {
            return;
        };
        self.local_toast = Some(LocalToast {
            text: msg,
            kind: "ok".into(),
            until: Instant::now() + Duration::from_millis(2200),
        });
    }

    pub(crate) fn toast_now(&mut self, text: impl Into<String>, kind: &str, ms: u64) {
        self.local_toast = Some(LocalToast {
            text: text.into(),
            kind: kind.into(),
            until: Instant::now() + Duration::from_millis(ms),
        });
    }

    pub(crate) fn purge_toast(&mut self) {
        if let Some(t) = &self.local_toast {
            if Instant::now() >= t.until {
                self.local_toast = None;
                // Toast row disappears → shell geometry shifts; wipe ghosts
                self.request_full_redraw();
            }
        }
    }

    pub fn tick_input(&mut self) {
        loop {
            match self.rx.try_recv() {
                Ok(msg) => self.apply_in(msg),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    self.should_quit = true;
                    break;
                }
            }
        }
    }

    /// Integer line scroll, clamped to [0, max_scroll_lines].
    /// Scrolling up leaves follow (stream will not re-attach until you return to bottom).
    /// Overscroll past bottom re-enters follow.
    pub(crate) fn apply_scroll_lines(&mut self, delta: i32) {
        if delta == 0 {
            return;
        }
        if delta > 0 {
            // older / up
            let next = (self.scroll_from_bottom as u32)
                .saturating_add(delta as u32)
                .min(self.max_scroll_lines as u32) as u16;
            self.scroll_from_bottom = next;
            if next > 0 {
                // Leave sticky-bottom: stream deltas must not drag the viewport
                self.auto_follow = false;
                self.follow_tail_boost = false;
            }
        } else {
            // newer / down
            self.scroll_from_bottom = self
                .scroll_from_bottom
                .saturating_sub((-delta) as u16);
            // Re-enter follow only when user explicitly reaches the latest edge
            if self.scroll_from_bottom == 0 {
                self.auto_follow = true;
                // 回底即恢复 Grok 预留空白（不要只绑 streaming）
                self.follow_tail_boost = true;
            }
        }
    }

    /// When content grows at the tail and the user is not following, increase
    /// `from_bottom` by the growth so the absolute viewport stays put
    /// (Ink `setMaxChatScroll(..., "pin-content")`).
    pub(crate) fn pin_scroll_on_max_change(from_bottom: usize, prev_max: usize, max_scroll: usize, auto_follow: bool) -> usize {
        if auto_follow || from_bottom == 0 {
            return 0;
        }
        if max_scroll > prev_max {
            from_bottom
                .saturating_add(max_scroll - prev_max)
                .min(max_scroll)
        } else {
            from_bottom.min(max_scroll)
        }
    }

    /// Chat wheel — 跟随系统触控板/滚轮事件节奏（macOS 惯性 = 连发 Scroll 事件）。
    ///
    /// - 慢/机械齿：事件间隔大 → **1 行/事件**（精准）
    /// - 用力甩：OS 高频连发 → 按间隔略增每事件行数，并靠更多事件叠加速度
    /// - 松手后惯性：仍由 OS 继续发事件驱动，应用层不伪造 coast
    ///
    /// `up` = older messages（from_bottom 增加）。
    pub(crate) fn note_wheel_chat(&mut self, up: bool) {
        let now = Instant::now();
        let dt_ms = now.duration_since(self.wheel_last_at).as_millis();
        if dt_ms > 160 {
            self.wheel_burst = 0;
            self.wheel_frac = 0.0;
        }
        // 本 burst 的第一下永远 1 行（冷启动 / 停顿后再拨）
        let first_in_burst = self.wheel_burst == 0;
        self.wheel_last_at = now;
        self.wheel_burst = self.wheel_burst.saturating_add(1).min(48);

        // 事件间隔 ≈ 系统瞬时速度；越密（甩）越大步，慢拨保持 1
        let lines: i32 = if first_in_burst || dt_ms >= 90 {
            1
        } else if dt_ms >= 48 {
            2
        } else if dt_ms >= 28 {
            3
        } else if dt_ms >= 16 {
            if self.wheel_burst >= 12 {
                5
            } else if self.wheel_burst >= 6 {
                4
            } else {
                3
            }
        } else if self.wheel_burst >= 16 {
            6
        } else {
            4
        };
        self.wheel_frac = 0.0;
        self.apply_scroll_lines(if up { lines } else { -lines });
    }

    pub(crate) fn apply_chrome(&mut self, chrome: ProtoChrome) {
        let was_streaming = self.streaming;
        let had_toast = self.chrome.toast.is_some();
        let had_goal = self
            .chrome
            .supervisor
            .as_ref()
            .map(|s| s.active)
            .unwrap_or(false);
        let had_ev_exp = self.chrome.event_block_expanded;
        let was_lite = self.chrome.lite;

        self.chrome = chrome.clone();
        self.streaming = chrome.streaming;
        // Stream ended → drop extra tail boost (keep 1-line pad while following)
        if was_streaming && !chrome.streaming {
            self.follow_tail_boost = false;
        }
        // Stream started while pinned to bottom → ensure follow + boost pad for AI room
        if !was_streaming && chrome.streaming && self.scroll_from_bottom == 0 {
            self.follow_tail_boost = true;
        }
        if !chrome.status.is_empty() {
            self.status = chrome.status.clone();
        }
        if let Some(m) = chrome.model.filter(|s| !s.is_empty()) {
            self.model = m;
        }
        if let Some(a) = chrome.agent.filter(|s| !s.is_empty()) {
            self.agent = a;
        }
        if let Some(t) = &self.chrome.toast {
            self.status = format!("[{}] {}", t.kind, t.text);
        }

        // 仅几何变化需要 full redraw；toast 文案变化不必 clear（差量画即可）
        let now_goal = self
            .chrome
            .supervisor
            .as_ref()
            .map(|s| s.active)
            .unwrap_or(false);
        if was_streaming != self.streaming
            || had_goal != now_goal
            || had_ev_exp != self.chrome.event_block_expanded
            || was_lite != self.chrome.lite
        {
            self.request_full_redraw();
        }
        let _ = had_toast;
    }

    /// Grok-style tail pad when pinned to latest (`auto_follow` && from_bottom==0).
    ///
    /// Pad so that **the last user message sits at the top of the viewport** while
    /// empty space below fills with AI output. As the tail grows, pad shrinks to 0
    /// and the view naturally scrolls down (still from_bottom=0).
    ///
    /// `tail_lines` = rendered lines from last user-head through end of content
    /// (before pad). If unknown, pass 0 → generous pad while streaming/boost.
    pub(crate) fn follow_tail_pad_lines(&self, viewport_h: usize, tail_lines: usize) -> usize {
        // Grok 式：只要有消息就预留尾部空白（文档高度稳定）。
        // 上滚时 pad 仍在文档末尾，滚回底部可再次吸附到预留空白；
        // 勿在 from_bottom!=0 时去掉 pad，否则 max_scroll 收缩、再也回不到「大空白」态。
        if self.messages.is_empty() {
            return 0;
        }
        let h = viewport_h.max(1);
        // pad = viewH − tail，使 last user 可顶到视口顶；AI 变长则 pad 缩小。
        if tail_lines > 0 {
            return h.saturating_sub(tail_lines).max(1);
        }
        // 尚无 tail 度量：发送瞬间用近满屏空白
        if self.streaming || self.follow_tail_boost {
            return h.saturating_sub(3).max(3);
        }
        1.min(h.saturating_sub(1).max(1))
    }

    /// Snap to latest + enable Grok tail pad (only when user was already following).
    pub(crate) fn pin_follow_for_send(&mut self) {
        // 前提：本来就在最下面；上滚阅读中发送不抢滚动
        if !(self.auto_follow || self.scroll_from_bottom == 0) {
            return;
        }
        self.scroll_from_bottom = 0;
        self.auto_follow = true;
        self.follow_tail_boost = true;
        // 发送后只清 scroll cache；full redraw 留给真正布局变化（overlay/审批条）
        self.scroll_render_cache = None;
    }

    pub(crate) fn apply_in(&mut self, msg: InMsg) {
        match msg {
            InMsg::Hello {
                product,
                model,
                agent,
                cwd,
            } => {
                if !product.is_empty() {
                    self.product = product;
                }
                if !model.is_empty() {
                    self.model = model;
                }
                if !agent.is_empty() {
                    self.agent = agent;
                }
                if !cwd.is_empty() {
                    self.cwd = cwd;
                }
            }
            InMsg::State {
                messages,
                streaming,
                status,
                system_events,
                chrome,
                theme,
                overlay,
                completions,
                terminal_approval,
                input,
                gallery_lines,
                full_paint,
            } => {
                // Never blank the transcript on a glitchy empty snapshot while we already
                // have history (except intentional clear: caller should send empty when idle
                // after /new). Empty+streaming mid-flight is treated as stale — keep local.
                let was_empty = self.messages.is_empty();
                let prev_msg_n = self.messages.len();
                let had_toast = self.local_toast.is_some() || self.chrome.toast.is_some();
                let had_approval = self.terminal_approval.is_some();
                let replace_msgs = !messages.is_empty()
                    || self.messages.is_empty()
                    || (!streaming && !self.streaming);
                if replace_msgs {
                    self.messages = messages;
                    // 消息内容变了：清选区，避免压缩/替换后蓝框残留在旧屏幕坐标
                    self.sel.clear();
                    // 消息增减只废缓存；empty↔非空（画廊）才 full redraw
                    if was_empty != self.messages.is_empty() {
                        self.scroll_render_cache = None;
                        self.request_full_redraw();
                    } else if prev_msg_n != self.messages.len() {
                        self.scroll_render_cache = None;
                    } else {
                        self.scroll_render_cache = None; // 流式 delta 也废缓存（内容变）
                    }
                }
                self.system_events = system_events;
                let was_streaming = self.streaming;
                self.streaming = streaming;
                if !streaming {
                    self.follow_tail_boost = false;
                }
                // stream 起停：差量画 chrome 即可，避免每轮双 clear
                let _ = was_streaming;
                if let Some(c) = chrome {
                    self.apply_chrome(c);
                } else if !status.is_empty() {
                    self.status = status;
                }
                if let Some(t) = theme {
                    self.theme.apply(&t);
                }
                let had_overlay = self.overlay.is_some();
                if let Some(o) = overlay {
                    let kind_changed = self
                        .overlay
                        .as_ref()
                        .map(|prev| prev.kind != o.kind)
                        .unwrap_or(true);
                    let section_changed = self.overlay.as_ref().map(|prev| {
                        prev.section_index != o.section_index
                            || prev.title != o.title
                    }).unwrap_or(false);
                    if kind_changed || !had_overlay {
                        self.overlay_sel =
                            o.selected.unwrap_or(0).min(o.items.len().saturating_sub(1));
                        self.overlay_scroll = 0;
                        self.overlay_hover = None;
                    } else if section_changed {
                        // prompt 切段：回到顶部
                        self.overlay_scroll = 0;
                    }
                    self.overlay = Some(o);
                    // Ink: open overlay clears input selection
                    self.sel.clear();
                    set_pointer_shape("default");
                    if !had_overlay || kind_changed {
                        self.request_full_redraw();
                    }
                } else if had_overlay {
                    self.overlay = None;
                    self.overlay_hover = None;
                    self.overlay_scroll = 0;
                    self.request_full_redraw();
                } else {
                    self.overlay = None;
                }
                // Completions menu open/close changes bottom chrome geometry
                let had_comp = self.completions.as_ref().map(|c| !c.items.is_empty()).unwrap_or(false);
                let now_comp = completions.as_ref().map(|c| !c.items.is_empty()).unwrap_or(false);
                if had_comp != now_comp {
                    self.request_full_redraw();
                }
                self.completions = completions;
                let now_approval = terminal_approval.is_some();
                if had_approval != now_approval {
                    self.request_full_redraw();
                    // 新审批出现：默认高亮 [Y] 一次，方便 Enter 确认
                    if now_approval {
                        self.approval_hover = Some("y".into());
                    } else {
                        self.approval_hover = None;
                        self.approval_chips.clear();
                    }
                }
                self.terminal_approval = terminal_approval;
                if let Some(i) = input {
                    // don't clobber if user is typing mid-flight unless empty local
                    if self.input.is_empty() || i != self.input {
                        // only apply external set when different path — Node sends draft
                        // skip overwrite while actively typing unless forced via InputSet
                    }
                    let _ = i;
                }
                if let Some(g) = gallery_lines {
                    if g != self.gallery_lines {
                        self.gallery_lines = g;
                        self.scroll_render_cache = None;
                        self.request_full_redraw();
                    }
                }
                let _ = had_toast;
                // Explicit hard paint from Node (/new, clear-screen epoch, …)
                if full_paint {
                    self.scroll_render_cache = None;
                    self.scroll_from_bottom = 0;
                    self.auto_follow = true;
                    self.request_full_redraw();
                }
                // Stream/state paint does not force follow — only user scroll-to-bottom /
                // pin_follow_for_send re-enters auto_follow. Growth pin happens in draw.
            }
            InMsg::FullPaint => {
                self.scroll_render_cache = None;
                self.request_full_redraw();
            }
            InMsg::MessagesSnapshot {
                messages,
                system_events,
            } => {
                let was_empty = self.messages.is_empty();
                self.messages = messages;
                self.system_events = system_events;
                if was_empty != self.messages.is_empty() {
                    self.scroll_render_cache = None;
                    self.request_full_redraw();
                }
            }
            InMsg::Chrome { chrome } => self.apply_chrome(chrome),
            InMsg::Completions { completions } => self.completions = completions,
            InMsg::InputSet { text, cursor } => {
                self.input = text;
                let c = cursor.unwrap_or(self.input.len()).min(self.input.len());
                self.cursor = mouse::snap_char_boundary(&self.input, c);
                // 历史回写：重置粘性视口，由光标位置决定起点（↑ 置顶 / ↓ 文末）
                self.input_view_offset = None;
            }
            InMsg::FullEditor { text } => {
                self.full_editor = true;
                // drop stale hit targets immediately (draw also clears on next frame)
                self.overlay_rect = None;
                self.completion_rect = None;
                self.event_rect = None;
                self.full_editor_text = if text.is_empty() {
                    self.input.clone()
                } else {
                    text
                };
                self.full_editor_cursor = self.full_editor_text.len();
                self.request_full_redraw();
            }
            InMsg::AssistantDelta { text, id } => {
                self.streaming = true;
                if let Some(id) = id {
                    if let Some(m) = self.messages.iter_mut().find(|m| m.id == id) {
                        m.content.push_str(&text);
                        m.streaming = true;
                        return;
                    }
                }
                if let Some(last) = self.messages.last_mut() {
                    if last.role == "assistant" {
                        last.content.push_str(&text);
                        last.streaming = true;
                        return;
                    }
                }
                self.messages.push(UiMessage {
                    id: format!("a{}", self.messages.len()),
                    role: "assistant".into(),
                    content: text,
                    streaming: true,
                    ..Default::default()
                });
            }
            InMsg::ThinkingDelta { text, id } => {
                self.streaming = true;
                let target = if let Some(id) = id {
                    self.messages.iter_mut().find(|m| m.id == id)
                } else {
                    self.messages.iter_mut().rev().find(|m| m.role == "assistant")
                };
                if let Some(m) = target {
                    if let Some(t) = m.thinking_blocks.last_mut() {
                        t.content.push_str(&text);
                        t.streaming = true;
                    } else {
                        m.thinking_blocks.push(ProtoThinking {
                            id: "th0".into(),
                            content: text,
                            streaming: true,
                            ..Default::default()
                        });
                    }
                }
            }
            InMsg::UserMessage { text } => {
                self.messages.push(UiMessage {
                    id: format!("u{}", self.messages.len()),
                    role: "user".into(),
                    content: text,
                    ..Default::default()
                });
                // New user turn from protocol → follow bottom + AI room
                self.pin_follow_for_send();
            }
            InMsg::Toast { text, level } => {
                self.status = if level.is_empty() {
                    text
                } else {
                    format!("[{level}] {text}")
                };
                // Toast bar changes shell geometry — force full paint to avoid chrome ghosts
                self.request_full_redraw();
            }
            InMsg::Quit => self.should_quit = true,
        }
    }

    pub(crate) fn emit_input(&mut self) {
        self.notify_caret_activity();
        emit(&OutMsg::InputUpdate {
            text: self.input.clone(),
            cursor: self.cursor,
        });
        self.last_input_emit = Instant::now();
    }

    /// Ink notifyCursorActivity: reset blink phase to "on" so typing isn't mid-off.
    pub(crate) fn notify_caret_activity(&mut self) {
        self.caret_blink_on = true;
        self.caret_blink_at = Instant::now();
    }

    /// Toggle software caret every ~530ms (Ink cursor blink).
    pub(crate) fn tick_caret_blink(&mut self) {
        if self.chrome.lite {
            self.caret_blink_on = true;
            return;
        }
        if self.caret_blink_at.elapsed() >= Duration::from_millis(530) {
            self.caret_blink_on = !self.caret_blink_on;
            self.caret_blink_at = Instant::now();
        }
    }

    /// Whether insert caret should paint (blink + mutex with selection/overlay).
    pub(crate) fn should_show_insert_caret(&self) -> bool {
        if self.sel.has_input_text_sel() {
            return false;
        }
        if self.overlay.is_some() {
            return false;
        }
        self.caret_blink_on
    }

    pub(crate) fn insert_str(&mut self, s: &str) {
        // typing re-pins input viewport to caret
        self.input_view_offset = None;
        // Ink scrubInput: strip mouse/CSI garbage before draft
        let s = scrub_input(s);
        if s.is_empty() {
            return;
        }
        // Ink: printable input replaces active text selection
        let _ = self.take_input_sel_delete();
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        self.input.insert_str(self.cursor, &s);
        self.cursor += s.len();
        self.emit_input();
    }

    pub(crate) fn backspace(&mut self) {
        // Ink InputBar: backspace deletes selection first
        if self.take_input_sel_delete() {
            self.emit_input();
            return;
        }
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        if self.cursor == 0 {
            return;
        }
        let prev = prev_char_boundary(&self.input, self.cursor);
        self.input.replace_range(prev..self.cursor, "");
        self.cursor = prev;
        self.emit_input();
    }

    pub(crate) fn delete_word(&mut self) {
        if self.take_input_sel_delete() {
            self.emit_input();
            return;
        }
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        if self.cursor == 0 {
            return;
        }
        let b = prev_word_boundary(&self.input, self.cursor);
        self.input.replace_range(b..self.cursor, "");
        self.cursor = b;
        self.emit_input();
    }

    pub(crate) fn delete_sentence(&mut self) {
        if self.take_input_sel_delete() {
            self.emit_input();
            return;
        }
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        if self.cursor == 0 {
            return;
        }
        let b = prev_sentence_boundary(&self.input, self.cursor);
        self.input.replace_range(b..self.cursor, "");
        self.cursor = b;
        self.emit_input();
    }

    /// Forward Delete (Ink TextArea Delete / sel-first).
    pub(crate) fn delete_forward(&mut self) {
        if self.take_input_sel_delete() {
            self.emit_input();
            return;
        }
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        if self.cursor >= self.input.len() {
            return;
        }
        let end = next_char_boundary(&self.input, self.cursor);
        self.input.replace_range(self.cursor..end, "");
        self.emit_input();
    }

    /// Bracketed paste / multi-char insert (caret ends after pasted block).
    pub(crate) fn paste_str(&mut self, s: &str) {
        // Normalize CRLF → LF (Ink paste path), then scrub control sequences
        let s = scrub_input(&s.replace("\r\n", "\n").replace('\r', "\n"));
        if s.is_empty() {
            return;
        }
        let _ = self.take_input_sel_delete();
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        self.input.insert_str(self.cursor, &s);
        self.cursor += s.len();
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        self.emit_input();
    }

    pub(crate) fn move_home_line(&mut self) {
        if self.collapse_input_sel(false) {
            self.emit_input();
            return;
        }
        use super::input_paint::display_row_home;
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        // Soft-wrap 显示行首（非仅 hard `\n`）
        self.cursor = display_row_home(&self.input, self.cursor, self.input_body_width());
        self.emit_input();
    }

    pub(crate) fn move_end_line(&mut self) {
        if self.collapse_input_sel(true) {
            self.emit_input();
            return;
        }
        use super::input_paint::display_row_end;
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        self.cursor = display_row_end(&self.input, self.cursor, self.input_body_width());
        self.emit_input();
    }

    // ── full editor buffer (same primitives as composer) ─────────────────

    pub(crate) fn fe_insert_str(&mut self, s: &str) {
        let s = scrub_input(&s.replace("\r\n", "\n").replace('\r', "\n"));
        if s.is_empty() {
            return;
        }
        let _ = self.take_fe_sel_delete();
        let c = mouse::snap_char_boundary(
            &self.full_editor_text,
            self.full_editor_cursor.min(self.full_editor_text.len()),
        );
        self.full_editor_text.insert_str(c, &s);
        self.full_editor_cursor = c + s.len();
    }

    /// Delete full-editor text selection if any (reuses InputSel byte ranges).
    pub(crate) fn take_fe_sel_delete(&mut self) -> bool {
        if let Some((a, b)) = self.sel.input_range() {
            let lo = mouse::snap_char_boundary(
                &self.full_editor_text,
                a.min(b).min(self.full_editor_text.len()),
            );
            let hi = mouse::snap_char_boundary(
                &self.full_editor_text,
                a.max(b).min(self.full_editor_text.len()),
            );
            if lo < hi {
                self.full_editor_text.replace_range(lo..hi, "");
                self.full_editor_cursor = lo;
                self.sel.clear();
                return true;
            }
            self.sel.clear();
            self.full_editor_cursor = lo;
        }
        false
    }

    pub(crate) fn fe_backspace(&mut self) {
        if self.take_fe_sel_delete() {
            return;
        }
        let c = mouse::snap_char_boundary(
            &self.full_editor_text,
            self.full_editor_cursor.min(self.full_editor_text.len()),
        );
        if c == 0 {
            return;
        }
        let prev = prev_char_boundary(&self.full_editor_text, c);
        self.full_editor_text.replace_range(prev..c, "");
        self.full_editor_cursor = prev;
    }

    pub(crate) fn fe_delete_forward(&mut self) {
        if self.take_fe_sel_delete() {
            return;
        }
        let c = mouse::snap_char_boundary(
            &self.full_editor_text,
            self.full_editor_cursor.min(self.full_editor_text.len()),
        );
        if c >= self.full_editor_text.len() {
            return;
        }
        let end = next_char_boundary(&self.full_editor_text, c);
        self.full_editor_text.replace_range(c..end, "");
        self.full_editor_cursor = c;
    }

    pub(crate) fn fe_delete_word(&mut self) {
        if self.take_fe_sel_delete() {
            return;
        }
        let c = mouse::snap_char_boundary(
            &self.full_editor_text,
            self.full_editor_cursor.min(self.full_editor_text.len()),
        );
        if c == 0 {
            return;
        }
        let b = prev_word_boundary(&self.full_editor_text, c);
        self.full_editor_text.replace_range(b..c, "");
        self.full_editor_cursor = b;
    }

    pub(crate) fn fe_delete_sentence(&mut self) {
        if self.take_fe_sel_delete() {
            return;
        }
        let c = mouse::snap_char_boundary(
            &self.full_editor_text,
            self.full_editor_cursor.min(self.full_editor_text.len()),
        );
        if c == 0 {
            return;
        }
        let b = prev_sentence_boundary(&self.full_editor_text, c);
        self.full_editor_text.replace_range(b..c, "");
        self.full_editor_cursor = b;
    }

    pub(crate) fn fe_home_line(&mut self) {
        let c = mouse::snap_char_boundary(
            &self.full_editor_text,
            self.full_editor_cursor.min(self.full_editor_text.len()),
        );
        self.full_editor_cursor = line_start(&self.full_editor_text, c);
    }

    pub(crate) fn fe_end_line(&mut self) {
        let c = mouse::snap_char_boundary(
            &self.full_editor_text,
            self.full_editor_cursor.min(self.full_editor_text.len()),
        );
        self.full_editor_cursor = line_end(&self.full_editor_text, c);
    }

    pub(crate) fn screen_dump_text(&self) -> String {
        // Ctrl+G：从显存整屏文字；头注明 ratatui，避免与 Ink dump 的 `· ink` 混淆
        let body = {
            let mut out = self.vram.dump_all();
            if out.trim().is_empty() {
                out = self.scroll_plain.join("\n");
            }
            out
        };
        let cols = self.vram.cols.max(self.screen_cols);
        let rows = self.vram.rows.max(self.screen_rows);
        let lines = body.lines().count();
        let chars = body.len();
        format!(
            "── maou screen dump · tty {cols}×{rows} · ratatui {cols}×{rows} ──\n{body}\n── end dump ({lines} lines, {chars} chars) ──"
        )
    }

    /// True if scroll line looks like a user bubble head (Ink user message).
    pub(crate) fn looks_user_head_line(line: &str) -> bool {
        (line.contains("user") || line.contains("user:"))
            && (line.contains('│') || line.contains('⨁') || line.contains('|'))
    }

    /// Ink older bar label: `↑ ` + preview of previous user body.
    pub(crate) fn prev_user_jump_label(&self, width: usize) -> String {
        let vis_top = self.visible_start;
        if vis_top == 0 || self.scroll_plain.is_empty() {
            return "↑ 上一条 user（点击）".into();
        }
        let mut head_i: Option<usize> = None;
        for i in (0..vis_top).rev() {
            if Self::looks_user_head_line(&self.scroll_plain[i]) {
                head_i = Some(i);
                break;
            }
        }
        let Some(hi) = head_i else {
            return "↑ 上一条 user（点击）".into();
        };
        let mut body = String::new();
        for j in (hi + 1)..self.scroll_plain.len().min(hi + 6) {
            let raw = self.scroll_plain[j].trim();
            if raw.is_empty() {
                continue;
            }
            // stop at next message head / assistant
            if raw.contains('◈')
                || raw.contains("agent:")
                || Self::looks_user_head_line(raw)
            {
                break;
            }
            let cleaned = raw
                .trim_start_matches('│')
                .trim_start_matches(' ')
                .trim_end_matches('⨁')
                .trim();
            if cleaned.is_empty() {
                continue;
            }
            if !body.is_empty() {
                body.push(' ');
            }
            body.push_str(cleaned);
            if body.chars().count() >= width.saturating_sub(4) {
                break;
            }
        }
        if body.is_empty() {
            "↑ 上一条 user（点击）".into()
        } else {
            let budget = width.saturating_sub(2).max(8);
            let mut out = String::from("↑ ");
            let mut used = 2usize;
            for ch in body.chars() {
                let cw = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1);
                if used + cw > budget {
                    out.push('…');
                    break;
                }
                out.push(ch);
                used += cw;
            }
            out
        }
    }

    /// Jump scroll so previous user message near top of viewport (Ink older-user bar).
    pub(crate) fn jump_prev_user(&mut self) {
        // Prefer content-anchored jump: scan scroll_plain upward from visible top
        let vis_top = self.visible_start;
        if vis_top > 0 && !self.scroll_plain.is_empty() {
            let mut target: Option<usize> = None;
            for i in (0..vis_top).rev() {
                if Self::looks_user_head_line(&self.scroll_plain[i]) {
                    target = Some(i);
                    break;
                }
            }
            if let Some(ti) = target {
                // pin target near top: from_bottom so that start ≈ ti
                let body_h = self.chat_inner.height.max(1) as usize;
                let total = self.scroll_plain.len();
                let end = (ti + body_h).min(total);
                let from_bottom = total.saturating_sub(end);
                self.scroll_from_bottom = from_bottom as u16;
                self.auto_follow = from_bottom == 0;
                self.follow_tail_boost = false;
                emit(&OutMsg::JumpPrevUser);
                return;
            }
        }
        // fallback: half viewport step
        self.scroll_from_bottom = self
            .scroll_from_bottom
            .saturating_add((self.chat_inner.height / 2).max(3));
        self.auto_follow = false;
        self.follow_tail_boost = false;
        emit(&OutMsg::JumpPrevUser);
    }

    /// Copy input / full-editor text selection (Ink Ctrl+C when sel on draft).
    pub(crate) fn copy_input_selection(&mut self) -> bool {
        if let Some((a, b)) = self.sel.input_range() {
            let src = if self.full_editor {
                &self.full_editor_text
            } else {
                &self.input
            };
            let lo = mouse::snap_char_boundary(src, a.min(b).min(src.len()));
            let hi = mouse::snap_char_boundary(src, a.max(b).min(src.len()));
            if lo < hi {
                let slice = src[lo..hi].to_string();
                if !slice.trim().is_empty() {
                    osc52_copy(&slice);
                    self.toast_copy(&slice);
                    return true;
                }
            }
        }
        false
    }

    /// Copy any active selection: input first, then chat/global (Ink meta+c / Ctrl+Shift+C).
    pub(crate) fn copy_active_selection(&mut self) -> bool {
        if self.copy_input_selection() {
            return true;
        }
        // only extract if there is a settled/live chat or global selection
        if !self.sel.has_chat_or_global_sel() {
            return false;
        }
        let plain = self.scroll_plain.clone();
        let t = self.sel.release_and_extract(
            &plain,
            &self.chat_line_cache,
            self.visible_start as i64,
            &self.input,
            &self.vram,
        );
        if !t.trim().is_empty() {
            osc52_copy(&t);
            self.toast_copy(&t);
            return true;
        }
        false
    }

    /// Hard `\n` line index（兼容旧逻辑）。
    pub(crate) fn cursor_line(&self) -> usize {
        let c = mouse::snap_char_boundary(&self.input, self.cursor);
        self.input[..c].bytes().filter(|&b| b == b'\n').count()
    }

    /// Soft-wrap 后的显示行下标（0-based）。
    pub(crate) fn cursor_display_row(&self) -> usize {
        use super::input_paint::{display_row_of_cursor, input_display_rows};
        let rows = input_display_rows(&self.input, self.input_body_width());
        let c = mouse::snap_char_boundary(&self.input, self.cursor);
        display_row_of_cursor(&rows, c)
    }

    /// 显示行总数（hard `\n` + soft wrap）。
    pub(crate) fn input_display_row_count(&self) -> usize {
        self.input_display_line_count()
    }

    /// ↑↓ 按显示行移动，保留视觉列。
    pub(crate) fn shift_input_display_row(&mut self, dir_up: bool) -> bool {
        use super::input_paint::shift_cursor_display_row;
        let before = self.cursor;
        let next = shift_cursor_display_row(
            &self.input,
            self.cursor,
            self.input_body_width(),
            dir_up,
        );
        if next != before {
            self.cursor = next;
            // 粘性视口跟随光标显示行
            if self.input_view_offset.is_some() {
                self.input_view_offset = Some(super::input_paint::input_view_start_with_offset(
                    &self.input,
                    self.cursor,
                    self.input_view_offset,
                    self.input_body_width(),
                ));
            }
            true
        } else {
            false
        }
    }

    pub(crate) fn clear_selection(&mut self) {
        self.sel.clear();
        set_pointer_shape("default");
    }

    pub(crate) fn content_x0(&self) -> u16 {
        self.chat_inner.x
    }

    /// Screen col → content col (0 = first cell of chat_inner line plain).
    /// Crossterm mouse is 0-based; ratatui Rect is 0-based — same space.
    pub(crate) fn screen_to_content_col(&self, col: u16) -> u16 {
        col.saturating_sub(self.content_x0())
    }

    /// Prompt prefix width for input (Ink: `" ❯ "` = 3 cols).
    pub(crate) fn input_prompt_cols(&self) -> u16 {
        mouse::prompt_cols()
    }

    /// Delete non-empty input selection if any; returns true if a range was removed.
    pub(crate) fn take_input_sel_delete(&mut self) -> bool {
        if let Some((a, b)) = self.sel.input_range() {
            let lo = mouse::snap_char_boundary(&self.input, a.min(b).min(self.input.len()));
            let hi = mouse::snap_char_boundary(&self.input, a.max(b).min(self.input.len()));
            if lo < hi {
                self.input.replace_range(lo..hi, "");
                self.cursor = lo;
                self.sel.clear();
                return true;
            }
            self.sel.clear();
            self.cursor = mouse::snap_char_boundary(&self.input, lo);
        }
        false
    }

    /// Collapse non-empty input sel to start (to_end=false) or end (to_end=true).
    pub(crate) fn collapse_input_sel(&mut self, to_end: bool) -> bool {
        if let Some((a, b)) = self.sel.input_range() {
            let lo = mouse::snap_char_boundary(&self.input, a.min(b).min(self.input.len()));
            let hi = mouse::snap_char_boundary(&self.input, a.max(b).min(self.input.len()));
            self.cursor = if to_end { hi } else { lo };
            self.sel.clear();
            true
        } else {
            false
        }
    }

    pub(crate) fn input_text_x0(&self) -> u16 {
        // 无左边框：文字从 input_rect.x 起 + " ❯ " 前缀
        self.input_rect.x.saturating_add(self.input_prompt_cols())
    }

}
