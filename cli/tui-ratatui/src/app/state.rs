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
    /// Scrolling up leaves follow; overscroll past bottom re-enters follow.
    pub(crate) fn apply_scroll_lines(&mut self, delta: i32) {
        if delta == 0 {
            return;
        }
        if delta > 0 {
            let next = (self.scroll_from_bottom as u32)
                .saturating_add(delta as u32)
                .min(self.max_scroll_lines as u32) as u16;
            self.scroll_from_bottom = next;
            if next > 0 {
                self.follow_tail_boost = false;
            }
        } else {
            self.scroll_from_bottom = self
                .scroll_from_bottom
                .saturating_sub((-delta) as u16);
            // Grok follow_by_overscroll: past bottom → follow again
            if self.scroll_from_bottom == 0 {
                self.follow_tail_boost = self.streaming;
            }
        }
    }

    /// Chat wheel: **event-driven, 1 line per tick** (macOS / Grok-aligned).
    ///
    /// Why not Ink/Grok `scrollWheelLines` 1→2→4 here?
    /// - Ink pairs big steps with **coalesce + ~25fps commit** (React is expensive):
    ///   many ticks merge into one apply, so step×N compensates dropped frames.
    /// - Grok pager similarly budgets paint (~30fps), not synthetic coast.
    /// - Ratatui paints every frame cheaply and applies **every** Scroll* event.
    ///   Using 2/4× on each OS tick **amplifies** macOS trackpad inertia
    ///   (system already streams decelerating events after lift).
    ///
    /// Standard: one terminal wheel report → one line; OS owns fling curve.
    /// `up` = older messages (from_bottom increases).
    pub(crate) fn note_wheel_chat(&mut self, up: bool) {
        let now = Instant::now();
        // Track burst for diagnostics / future coalesce only (no step amp).
        if now.duration_since(self.wheel_last_at).as_millis() > 140 {
            self.wheel_burst = 0;
        }
        self.wheel_last_at = now;
        self.wheel_burst = self.wheel_burst.saturating_add(1).min(40);
        self.apply_scroll_lines(if up { 1 } else { -1 });
    }

    pub(crate) fn apply_chrome(&mut self, chrome: ProtoChrome) {
        let was_streaming = self.streaming;
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
    }

    /// Ink `BOTTOM_PAD` when pinned to latest (`scroll_from_bottom==0`).
    /// Keep this **small**: a large pad makes `from_bottom=0` show mostly empty
    /// rows and shoves prior messages off-screen (feels like “content vanished”).
    pub(crate) fn follow_tail_pad_lines(&self, viewport_h: usize) -> usize {
        if self.scroll_from_bottom != 0 {
            return 0;
        }
        let h = viewport_h.max(1);
        // Always leave ≥ half the viewport for real content.
        let max_pad = (h / 2).saturating_sub(1).max(1);
        if self.streaming || self.follow_tail_boost {
            // Modest room for stream growth (not 40% of the pane).
            3.min(max_pad).min(h.saturating_sub(4).max(1))
        } else {
            // Ink BOTTOM_PAD = 1
            1.min(max_pad).min(h.saturating_sub(1).max(1))
        }
    }

    /// Snap to latest + enable tail boost (call on send while user is following).
    pub(crate) fn pin_follow_for_send(&mut self) {
        self.scroll_from_bottom = 0;
        self.follow_tail_boost = true;
        // Send/stream layout shift often desyncs ratatui's diff buffer → blank holes
        // until resize. Force one full frame (user can also shrink window as workaround).
        self.request_full_redraw();
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
            } => {
                // Never blank the transcript on a glitchy empty snapshot while we already
                // have history (except intentional clear: caller should send empty when idle
                // after /new). Empty+streaming mid-flight is treated as stale — keep local.
                let replace_msgs = !messages.is_empty()
                    || self.messages.is_empty()
                    || (!streaming && !self.streaming);
                if replace_msgs {
                    self.messages = messages;
                }
                self.system_events = system_events;
                self.streaming = streaming;
                if !streaming {
                    self.follow_tail_boost = false;
                }
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
                    self.overlay_sel = o.selected.unwrap_or(0).min(o.items.len().saturating_sub(1));
                    self.overlay = Some(o);
                    // Ink: open overlay clears input selection
                    self.sel.clear();
                    set_pointer_shape("default");
                    if !had_overlay {
                        self.request_full_redraw();
                    }
                } else if had_overlay {
                    self.overlay = None;
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
                    self.gallery_lines = g;
                }
                // Ink autoFollow: stay pinned to latest while following
                if self.scroll_from_bottom == 0 {
                    self.scroll_from_bottom = 0;
                }
            }
            InMsg::MessagesSnapshot {
                messages,
                system_events,
            } => {
                self.messages = messages;
                self.system_events = system_events;
            }
            InMsg::Chrome { chrome } => self.apply_chrome(chrome),
            InMsg::Completions { completions } => self.completions = completions,
            InMsg::InputSet { text, cursor } => {
                self.input = text;
                let c = cursor.unwrap_or(self.input.len()).min(self.input.len());
                self.cursor = mouse::snap_char_boundary(&self.input, c);
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
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        self.cursor = line_start(&self.input, self.cursor);
        self.emit_input();
    }

    pub(crate) fn move_end_line(&mut self) {
        if self.collapse_input_sel(true) {
            self.emit_input();
            return;
        }
        self.cursor = mouse::snap_char_boundary(&self.input, self.cursor);
        self.cursor = line_end(&self.input, self.cursor);
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
        // 与 Ink Ctrl+G 一致：从显存整屏文字
        let mut out = self.vram.dump_all();
        if out.trim().is_empty() {
            // 回退逻辑行
            out = self.scroll_plain.join("\n");
        }
        out
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
                emit(&OutMsg::JumpPrevUser);
                return;
            }
        }
        // fallback: half viewport step
        self.scroll_from_bottom = self
            .scroll_from_bottom
            .saturating_add((self.chat_inner.height / 2).max(3));
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

    pub(crate) fn cursor_line(&self) -> usize {
        let c = mouse::snap_char_boundary(&self.input, self.cursor);
        self.input[..c].bytes().filter(|&b| b == b'\n').count()
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
