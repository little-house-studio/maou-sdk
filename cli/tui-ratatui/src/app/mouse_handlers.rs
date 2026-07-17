//! Mouse / wheel / hover handlers (Ink useMouseInput parity).

use super::App;
use super::input_paint::{
    display_row_visual_to_byte, input_display_rows, input_view_start_with_offset,
};
use crate::mouse::{
    self, input_visual_to_byte, osc52_copy, pin_chat_edge_abs_y, plain_line_visual_cols,
    plain_word_visual_cols, point_in_rect, resolve_sel_mode, screen_to_abs_y, set_pointer_shape,
    vram_line_bounds, vram_word_bounds, word_bounds, CellPos, DragState, INPUT_DRAG_THRESHOLD,
    SelMode,
};
use crate::protocol::{emit, OutMsg};
use crossterm::event::{KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use std::time::{Duration, Instant};
use unicode_width::UnicodeWidthStr; // approval bar hit cols

impl App {
    pub fn tick_mouse_edge(&mut self) {
        self.sel.tick_phase();
        let Some(d) = self.sel.drag.as_ref() else { return };
        if d.mode != SelMode::Chat || !d.moved {
            return;
        }
        let Some(dir) = d.edge_dir else { return };
        if self.last_edge_tick.elapsed() < Duration::from_millis(40) {
            return;
        }
        self.last_edge_tick = Instant::now();
        if dir < 0 {
            self.scroll_from_bottom = self.scroll_from_bottom.saturating_add(1);
        } else {
            self.scroll_from_bottom = self.scroll_from_bottom.saturating_sub(1);
        }
        // pin end to edge absY (content-anchored) + screen row for drag end
        let end_row = if dir < 0 {
            self.chat_inner.y
        } else {
            self.chat_inner
                .y
                .saturating_add(self.chat_inner.height.saturating_sub(1))
        };
        let end_col = self
            .sel
            .drag
            .as_ref()
            .map(|d| d.end.col)
            .unwrap_or(self.chat_inner.x);
        let word_mode = self.sel.drag.as_ref().map(|d| d.word_mode).unwrap_or(false);
        if let Some(d) = self.sel.drag.as_mut() {
            d.end.row = end_row;
        }
        let col = self.screen_to_content_col(end_col);
        let plain = self.scroll_plain.clone();
        let ay = pin_chat_edge_abs_y(dir, self.visible_start as i64, self.chat_inner.height);
        let end_col_rel = if word_mode {
            plain
                .get(ay as usize)
                .map(|t| plain_word_visual_cols(t, col as usize).1)
                .unwrap_or(col)
        } else {
            col
        };
        self.sel.update_chat_end(ay, end_col_rel, &plain);
        self.sel.capture_visible(
            &self.chat_line_cache,
            self.visible_start as i64,
            self.chat_inner.y,
        );
    }

    pub fn on_mouse(&mut self, m: MouseEvent) {
        let col = m.column;
        let row = m.row;
        self.sel.tick_phase();

        // Ink: fullEditorInitial first — never let stale overlay_rect steal wheel/click
        if mouse::mouse_preempts_overlay(self.full_editor) {
            match m.kind {
                MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
                    let up = matches!(m.kind, MouseEventKind::ScrollUp);
                    self.full_editor_cursor = mouse::shift_cursor_line(
                        &self.full_editor_text,
                        self.full_editor_cursor,
                        up,
                    );
                }
                MouseEventKind::Down(MouseButton::Left) => {
                    if let Some(r) = self.full_editor_rect {
                        if point_in_rect(col, row, r) {
                            let n = self.sel.register_click(col, row);
                            let n_lines = self.full_editor_text.split('\n').count().max(1);
                            let line_off =
                                (row.saturating_sub(r.y) as usize).min(n_lines.saturating_sub(1));
                            let vcol = col.saturating_sub(r.x) as usize;
                            let byte = mouse::input_visual_to_byte(
                                &self.full_editor_text,
                                line_off,
                                vcol,
                            );
                            self.full_editor_cursor = byte;
                            if n == 2 {
                                let (a, z) = mouse::word_bounds(&self.full_editor_text, byte);
                                self.sel.active =
                                    Some(mouse::ActiveSel::Input(mouse::InputSel {
                                        start_byte: a,
                                        end_byte: z,
                                    }));
                                self.sel.live();
                                self.full_editor_cursor = z;
                                let t = mouse::safe_str_slice(
                                    &self.full_editor_text,
                                    a.min(z),
                                    a.max(z).min(self.full_editor_text.len()),
                                )
                                .to_string();
                                if !t.trim().is_empty() {
                                    osc52_copy(&t);
                                    self.toast_copy(&t);
                                }
                                let _ = self.sel.release_and_extract(
                                    &[],
                                    &[],
                                    0,
                                    &self.full_editor_text,
                                    &self.vram,
                                );
                            } else if n >= 3 {
                                self.sel.active =
                                    Some(mouse::ActiveSel::Input(mouse::InputSel {
                                        start_byte: 0,
                                        end_byte: self.full_editor_text.len(),
                                    }));
                                self.sel.live();
                                let full = self.full_editor_text.clone();
                                if !full.trim().is_empty() {
                                    osc52_copy(&full);
                                    self.toast_copy(&full);
                                }
                                let _ = self.sel.release_and_extract(
                                    &[],
                                    &[],
                                    0,
                                    &self.full_editor_text,
                                    &self.vram,
                                );
                            } else {
                                self.sel.start_input(byte);
                                self.sel.drag = Some(DragState {
                                    mode: SelMode::Input,
                                    start: CellPos { row, col },
                                    end: CellPos { row, col },
                                    moved: false,
                                    click_count: 1,
                                    word_mode: false,
                                    edge_dir: None,
                                    start_abs_y: 0,
                                    start_byte: byte,
                                });
                            }
                            set_pointer_shape("text");
                        }
                    }
                }
                MouseEventKind::Drag(MouseButton::Left) | MouseEventKind::Moved => {
                    let is_drag = matches!(m.kind, MouseEventKind::Drag(MouseButton::Left));
                    if !is_drag && self.sel.drag.is_none() {
                        set_pointer_shape("text");
                        return;
                    }
                    let Some(d) = self.sel.drag.as_mut() else {
                        return;
                    };
                    if d.mode != SelMode::Input {
                        return;
                    }
                    d.end = CellPos { row, col };
                    if d.start.col.abs_diff(col) > INPUT_DRAG_THRESHOLD
                        || d.start.row.abs_diff(row) > 0
                    {
                        d.moved = true;
                    }
                    if !d.moved {
                        return;
                    }
                    if let Some(r) = self.full_editor_rect {
                        let n_lines = self.full_editor_text.split('\n').count().max(1);
                        let clamp_row = row.clamp(
                            r.y,
                            r.y.saturating_add(r.height.saturating_sub(1)),
                        );
                        let clamp_col = col.clamp(
                            r.x,
                            r.x.saturating_add(r.width.saturating_sub(1)).max(r.x),
                        );
                        let lo =
                            (clamp_row.saturating_sub(r.y) as usize).min(n_lines.saturating_sub(1));
                        let vcol = clamp_col.saturating_sub(r.x) as usize;
                        let end_b =
                            mouse::input_visual_to_byte(&self.full_editor_text, lo, vcol);
                        self.sel.update_input_end(end_b);
                        self.full_editor_cursor = end_b;
                        set_pointer_shape("text");
                    }
                }
                MouseEventKind::Up(MouseButton::Left) => {
                    if let Some(d) = self.sel.drag.take() {
                        if d.moved || d.click_count >= 2 {
                            let t = self.sel.release_and_extract(
                                &[],
                                &[],
                                0,
                                &self.full_editor_text,
                                &self.vram,
                            );
                            if !t.trim().is_empty() {
                                osc52_copy(&t);
                                self.toast_copy(&t);
                            }
                        } else {
                            self.sel.clear();
                        }
                    }
                    set_pointer_shape("text");
                }
                _ => {}
            }
            return;
        }

        // Overlay second (only when not in full editor)
        if let Some(or) = self.overlay_rect {
            if point_in_rect(col, row, or) {
                match m.kind {
                    MouseEventKind::ScrollUp => {
                        self.overlay_sel = self.overlay_sel.saturating_sub(1);
                        return;
                    }
                    MouseEventKind::ScrollDown => {
                        if let Some(o) = &self.overlay {
                            if !o.items.is_empty() {
                                self.overlay_sel =
                                    (self.overlay_sel + 1).min(o.items.len() - 1);
                            }
                        }
                        return;
                    }
                    MouseEventKind::Down(MouseButton::Left) => {
                        if let Some(o) = &self.overlay {
                            if !o.items.is_empty() {
                                // body starts after top border; list windowed from overlay_list_from
                                let body_y = or.y.saturating_add(1);
                                if row >= body_y {
                                    let rel = (row - body_y) as usize;
                                    let vis = self.overlay_list_count.max(1);
                                    // footer is last painted line — ignore
                                    if rel < vis {
                                        let abs = self.overlay_list_from + rel;
                                        if abs < o.items.len() {
                                            self.overlay_sel = abs;
                                            let val = o.items[abs].value.clone();
                                            emit(&OutMsg::OverlayAction {
                                                action: "select".into(),
                                                value: Some(val),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        return;
                    }
                    MouseEventKind::Moved => {
                        // Ink SelectList: hover recolors only; do not change selected
                        set_pointer_shape("pointer");
                        return;
                    }
                    _ => {}
                }
            } else if matches!(m.kind, MouseEventKind::Down(MouseButton::Left)) {
                emit(&OutMsg::Escape);
                return;
            }
        }

        // Terminal approval bar: hit-test paint-time chip rects (not rebuilt string)
        if let (Some(ar), Some(ta)) = (self.approval_rect, self.terminal_approval.as_ref()) {
            if point_in_rect(col, row, ar) {
                // chips only on first row of the 3-line bar
                let on_chip_row = row == ar.y;
                let choice = if on_chip_row {
                    self.approval_chips
                        .iter()
                        .find(|(x0, x1, _)| col >= *x0 && col < *x1)
                        .map(|(_, _, c)| c.as_str())
                } else {
                    None
                };
                match m.kind {
                    MouseEventKind::Moved => {
                        self.approval_hover = choice.map(|c| c.to_string());
                        set_pointer_shape(if choice.is_some() {
                            "pointer"
                        } else {
                            "default"
                        });
                        return;
                    }
                    MouseEventKind::Down(MouseButton::Left) => {
                        if let Some(c) = choice {
                            emit(&OutMsg::Approval {
                                id: ta.id.clone(),
                                choice: c.into(),
                            });
                            self.approval_hover = None;
                            set_pointer_shape("pointer");
                            return;
                        }
                        // 点在非 chip 区域不误触拒绝
                        return;
                    }
                    _ => {}
                }
            } else if matches!(m.kind, MouseEventKind::Moved) {
                self.approval_hover = None;
            }
        }

        match m.kind {
            MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
                let up = matches!(m.kind, MouseEventKind::ScrollUp);
                let dir_s = if up { "up" } else { "down" };
                // drag chat: scroll + keep content-anchored sel (Ink dragging branch)
                if self
                    .sel
                    .drag
                    .as_ref()
                    .map(|d| d.mode == SelMode::Chat && d.moved)
                    == Some(true)
                {
                    // drag-select scroll: 1 line (precise)
                    if up {
                        self.scroll_from_bottom = self.scroll_from_bottom.saturating_add(1);
                    } else {
                        self.scroll_from_bottom = self.scroll_from_bottom.saturating_sub(1);
                    }
                    if let Some(d) = self.sel.drag.as_mut() {
                        d.end = CellPos { row, col };
                    }
                    let ccol = self.screen_to_content_col(col);
                    if let Some(ay) =
                        screen_to_abs_y(row, self.chat_inner.y, self.visible_start)
                    {
                        let plain = self.scroll_plain.clone();
                        self.sel.update_chat_end(ay, ccol, &plain);
                    }
                    return;
                }
                // Ink: non-drag wheel clears chat blue selection
                if self.sel.drag.is_none() {
                    if let Some(mouse::ActiveSel::Chat(_)) = &self.sel.active {
                        self.sel.clear();
                    }
                }
                let over_comp = self
                    .completion_rect
                    .map(|cr| point_in_rect(col, row, cr))
                    .unwrap_or(false);
                let over_input = point_in_rect(col, row, self.input_rect);
                let target = mouse::resolve_wheel_target(
                    self.full_editor,
                    self.overlay.is_some(),
                    self.chrome.event_block_expanded,
                    over_comp,
                    over_input,
                );
                match target {
                    mouse::WheelTarget::FullEditor => {
                        self.full_editor_cursor = mouse::shift_cursor_line(
                            &self.full_editor_text,
                            self.full_editor_cursor,
                            up,
                        );
                    }
                    mouse::WheelTarget::Overlay => {
                        if up {
                            self.overlay_sel = self.overlay_sel.saturating_sub(1);
                        } else if let Some(o) = &self.overlay {
                            if !o.items.is_empty() {
                                self.overlay_sel =
                                    (self.overlay_sel + 1).min(o.items.len() - 1);
                            }
                        }
                    }
                    mouse::WheelTarget::EventBlockExpanded => {
                        // Ink: over EventBlock → scroll expanded supervisor log locally
                        let over_ev = self
                            .event_rect
                            .map(|r| point_in_rect(col, row, r))
                            .unwrap_or(false);
                        if over_ev && self.chrome.event_block_expanded {
                            if up {
                                self.event_expand_scroll =
                                    self.event_expand_scroll.saturating_sub(1);
                            } else {
                                self.event_expand_scroll =
                                    self.event_expand_scroll.saturating_add(1);
                            }
                            // also notify Node for Ink-parity store cmd (no-op paint there)
                            emit(&OutMsg::SupervisorScroll {
                                dir: dir_s.into(),
                            });
                        } else {
                            // wheel outside expanded block → chat (OS events drive inertia)
                            self.note_wheel_chat(up);
                        }
                    }
                    mouse::WheelTarget::Completion => {
                        emit(&OutMsg::CompleteCycle {
                            dir: dir_s.into(),
                        });
                    }
                    mouse::WheelTarget::InputHistory => {
                        emit(&OutMsg::History {
                            dir: dir_s.into(),
                        });
                    }
                    mouse::WheelTarget::Chat => {
                        // macOS trackpad: OS already streams decelerating Scroll* after lift
                        self.note_wheel_chat(up);
                    }
                }
            }

            MouseEventKind::Down(MouseButton::Left) => {
                // EventBlock click → toggle expand (Ink toggleEventBlockExpanded)
                if let Some(er) = self.event_rect {
                    if point_in_rect(col, row, er) {
                        self.chrome.event_block_expanded = !self.chrome.event_block_expanded;
                        emit(&OutMsg::EventBlockToggle);
                        return;
                    }
                }
                if let Some(by) = self.back_to_bottom_y {
                    if row == by {
                        // Back to bottom: re-enter follow (pad returns on next draw)
                        self.scroll_from_bottom = 0;
                        self.follow_tail_boost = self.streaming;
                        self.clear_selection();
                        emit(&OutMsg::ScrollToBottom);
                        return;
                    }
                }
                if let Some(jy) = self.jump_prev_y {
                    if row == jy {
                        self.jump_prev_user();
                        return;
                    }
                }
                if let Some(gr) = self.goal_rect {
                    if point_in_rect(col, row, gr) {
                        if let Some(sup) = &self.chrome.supervisor {
                            match sup.state.as_str() {
                                "confirming_plan" => emit(&OutMsg::GoalAction {
                                    action: "confirm_plan".into(),
                                }),
                                "confirming" => emit(&OutMsg::GoalAction {
                                    action: "confirm_pass".into(),
                                }),
                                _ => {}
                            }
                        }
                        return;
                    }
                }
                if point_in_rect(col, row, self.nav_rect) {
                    let hit = self.nav_segs.iter().find(|(x0, x1, ..)| col >= *x0 && col < *x1);
                    if let Some((_, _, id, action_kind, action_value)) = hit {
                        let kind = action_kind.clone();
                        let val = action_value.clone();
                        let id = id.clone();
                        match kind.as_str() {
                            "hotkey" if !val.is_empty() => {
                                emit(&OutMsg::Hotkey { key: val });
                            }
                            "command" if !val.is_empty() => {
                                emit(&OutMsg::Command {
                                    id: val,
                                    args: None,
                                });
                            }
                            "toast" if !val.is_empty() => {
                                self.toast_now(val, "info", 1800);
                            }
                            _ => match id.as_str() {
                                "agent" => emit(&OutMsg::Hotkey {
                                    key: "open_agents".into(),
                                }),
                                "sessions" | "sess" => emit(&OutMsg::Command {
                                    id: "sessions".into(),
                                    args: None,
                                }),
                                "settings" | "set" => emit(&OutMsg::Hotkey {
                                    key: "ctrl+,".into(),
                                }),
                                "todo" | "terminal" | "term" => emit(&OutMsg::Hotkey {
                                    key: "ctrl+k".into(),
                                }),
                                _ => {}
                            },
                        }
                        return;
                    }
                }
                if let Some(cr) = self.completion_rect {
                    if point_in_rect(col, row, cr) {
                        // Ink: click row → select that item then accept
                        let items = self
                            .completions
                            .as_ref()
                            .map(|c| c.items.len().min(5))
                            .unwrap_or(0);
                        if items > 0 && row >= cr.y {
                            let rel = (row - cr.y) as usize;
                            // last line is footer hint — ignore
                            if rel < items {
                                emit(&OutMsg::CompleteSelect { index: rel });
                                return;
                            }
                        }
                        return;
                    }
                }

                // tool / thinking / expand / system-event before selection (only inside chat)
                if point_in_rect(col, row, self.chat_inner) {
                    if let Some(cache_i) =
                        self.chat_line_cache.iter().position(|(r, _, _)| *r == row)
                    {
                        let line_idx = self.visible_start + cache_i;
                        for th in &self.tool_hits {
                            if th.line_idx == line_idx {
                                emit(&OutMsg::ToolToggle {
                                    message_id: th.message_id.clone(),
                                    tool_id: th.tool_id.clone(),
                                });
                                return;
                            }
                        }
                        for th in &self.thinking_hits {
                            if th.line_idx == line_idx {
                                emit(&OutMsg::ThinkingToggle {
                                    id: th.thinking_id.clone(),
                                });
                                return;
                            }
                        }
                        for eh in &self.msg_expand_hits {
                            if eh.line_idx == line_idx {
                                emit(&OutMsg::MessageExpand {
                                    id: eh.message_id.clone(),
                                });
                                return;
                            }
                        }
                        // Ink SystemEventRow: click banner toggles local detail open
                        for se in &self.system_event_hits {
                            if se.line_idx == line_idx {
                                let id = se.event_id.clone();
                                if self.expanded_system_events.contains(&id) {
                                    self.expanded_system_events.remove(&id);
                                } else {
                                    self.expanded_system_events.insert(id);
                                }
                                return;
                            }
                        }
                        // Ink DiffCollapsible: toggle full tool result
                        for tr in &self.tool_result_hits {
                            if tr.line_idx == line_idx {
                                let id = tr.tool_id.clone();
                                if self.expanded_tool_results.contains(&id) {
                                    self.expanded_tool_results.remove(&id);
                                } else {
                                    self.expanded_tool_results.insert(id);
                                }
                                return;
                            }
                        }
                    }
                }

                // Ink resolveMode: input → chat → global by press origin
                let mode = resolve_sel_mode(col, row, self.chat_inner, self.input_rect);
                let n = self.sel.register_click(col, row);
                let plain = self.scroll_plain.clone();
                let shift = m.modifiers.contains(KeyModifiers::SHIFT);

                // Ink Shift+click: extend chat/global from sticky/active anchor
                if shift && n == 1 && (mode == SelMode::Chat || mode == SelMode::Global) {
                    match mode {
                        SelMode::Chat => {
                            let ccol = self.screen_to_content_col(col);
                            if let Some(ay) =
                                screen_to_abs_y(row, self.chat_inner.y, self.visible_start)
                            {
                                self.sel.start_chat_opts(ay, ccol, &plain, true);
                                self.sel.capture_visible(
                                    &self.chat_line_cache,
                                    self.visible_start as i64,
                                    self.chat_inner.y,
                                );
                                self.sel.live();
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
                                }
                                // keep settled highlight; allow further shift-drag
                                self.sel.drag = Some(DragState {
                                    mode: SelMode::Chat,
                                    start: CellPos { row, col },
                                    end: CellPos { row, col },
                                    moved: true,
                                    click_count: 1,
                                    word_mode: false,
                                    edge_dir: None,
                                    start_abs_y: ay,
                                    start_byte: 0,
                                });
                                set_pointer_shape("grab");
                            }
                        }
                        SelMode::Global => {
                            self.sel.start_global_opts(row, col, true);
                            self.sel.live();
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
                            }
                            self.sel.drag = Some(DragState {
                                mode: SelMode::Global,
                                start: CellPos { row, col },
                                end: CellPos { row, col },
                                moved: true,
                                click_count: 1,
                                word_mode: false,
                                edge_dir: None,
                                start_abs_y: 0,
                                start_byte: 0,
                            });
                            set_pointer_shape("grab");
                        }
                        _ => {}
                    }
                    return;
                }

                match mode {
                    SelMode::Input => {
                        let text_x0 = self.input_text_x0();
                        let body_w = self.input_body_width();
                        let vcol = col.saturating_sub(text_x0) as usize;
                        let vis_row = row.saturating_sub(self.input_rect.y) as usize;
                        let rows = input_display_rows(&self.input, body_w);
                        let view0 = input_view_start_with_offset(
                            &self.input,
                            self.cursor,
                            self.input_view_offset,
                            body_w,
                        );
                        let disp = view0 + vis_row;
                        let byte =
                            display_row_visual_to_byte(&self.input, &rows, disp, vcol);
                        self.cursor = byte;
                        if n == 2 {
                            let (a, z) = word_bounds(&self.input, byte);
                            self.sel.active = Some(mouse::ActiveSel::Input(mouse::InputSel {
                                start_byte: a,
                                end_byte: z,
                            }));
                            self.sel.live();
                            self.cursor = z;
                            let t = mouse::safe_str_slice(
                                &self.input,
                                a.min(z),
                                a.max(z).min(self.input.len()),
                            )
                            .to_string();
                            if !t.trim().is_empty() {
                                osc52_copy(&t);
                                self.toast_copy(&t);
                            }
                            let _ = self.sel.release_and_extract(
                                &plain,
                                &self.chat_line_cache,
                                self.visible_start as i64,
                                &self.input,
                                &self.vram,
                            );
                        } else if n >= 3 {
                            self.sel.active = Some(mouse::ActiveSel::Input(mouse::InputSel {
                                start_byte: 0,
                                end_byte: self.input.len(),
                            }));
                            self.sel.live();
                            let full = self.input.clone();
                            if !full.trim().is_empty() {
                                osc52_copy(&full);
                                self.toast_copy(&full);
                            }
                            let _ = self.sel.release_and_extract(
                                &plain,
                                &self.chat_line_cache,
                                self.visible_start as i64,
                                &self.input,
                                &self.vram,
                            );
                        } else {
                            // Ink: no blue until drag threshold
                            self.sel.start_input(byte);
                            self.sel.drag = Some(DragState {
                                mode: SelMode::Input,
                                start: CellPos { row, col },
                                end: CellPos { row, col },
                                moved: false,
                                click_count: 1,
                                word_mode: false,
                                edge_dir: None,
                                start_abs_y: 0,
                                start_byte: byte,
                            });
                        }
                        self.emit_input();
                        set_pointer_shape("text");
                    }
                    SelMode::Chat => {
                        let ccol = self.screen_to_content_col(col);
                        let Some(ay) =
                            screen_to_abs_y(row, self.chat_inner.y, self.visible_start)
                        else {
                            return;
                        };
                        if n == 2 {
                            if let Some(text) = plain.get(ay as usize) {
                                let (c0, c1) = plain_word_visual_cols(text, ccol as usize);
                                self.sel.start_chat(ay, c0, &plain);
                                self.sel.update_chat_end(ay, c1, &plain);
                                self.sel.capture_visible(
                                    &self.chat_line_cache,
                                    self.visible_start as i64,
                                    self.chat_inner.y,
                                );
                                self.sel.drag = Some(DragState {
                                    mode: SelMode::Chat,
                                    start: CellPos { row, col },
                                    end: CellPos { row, col },
                                    moved: true,
                                    click_count: n,
                                    word_mode: true,
                                    edge_dir: None,
                                    start_abs_y: ay,
                                    start_byte: 0,
                                });
                                set_pointer_shape("text");
                                return;
                            }
                        } else if n >= 3 {
                            if let Some(text) = plain.get(ay as usize) {
                                let (c0, c1) = plain_line_visual_cols(text);
                                self.sel.start_chat(ay, c0, &plain);
                                self.sel.update_chat_end(ay, c1, &plain);
                                self.sel.capture_visible(
                                    &self.chat_line_cache,
                                    self.visible_start as i64,
                                    self.chat_inner.y,
                                );
                                self.sel.drag = Some(DragState {
                                    mode: SelMode::Chat,
                                    start: CellPos { row, col },
                                    end: CellPos { row, col },
                                    moved: true,
                                    click_count: n,
                                    word_mode: false,
                                    edge_dir: None,
                                    start_abs_y: ay,
                                    start_byte: 0,
                                });
                                set_pointer_shape("text");
                                return;
                            }
                        }
                        self.sel.start_chat(ay, ccol, &plain);
                        self.sel.capture_visible(
                            &self.chat_line_cache,
                            self.visible_start as i64,
                            self.chat_inner.y,
                        );
                        self.sel.drag = Some(DragState {
                            mode: SelMode::Chat,
                            start: CellPos { row, col },
                            end: CellPos { row, col },
                            moved: false,
                            click_count: n,
                            word_mode: false,
                            edge_dir: None,
                            start_abs_y: ay,
                            start_byte: 0,
                        });
                        set_pointer_shape("grab");
                    }
                    SelMode::Global => {
                        if n == 2 {
                            let (c0, c1) = vram_word_bounds(&self.vram, row, col);
                            self.sel.start_global(row, c0);
                            self.sel.update_global_end(row, c1);
                            self.sel.drag = Some(DragState {
                                mode: SelMode::Global,
                                start: CellPos { row, col: c0 },
                                end: CellPos { row, col: c1 },
                                moved: true,
                                click_count: n,
                                word_mode: true,
                                edge_dir: None,
                                start_abs_y: 0,
                                start_byte: 0,
                            });
                        } else if n >= 3 {
                            let (c0, c1) = vram_line_bounds(&self.vram, row);
                            self.sel.start_global(row, c0);
                            self.sel.update_global_end(row, c1);
                            self.sel.drag = Some(DragState {
                                mode: SelMode::Global,
                                start: CellPos { row, col: c0 },
                                end: CellPos { row, col: c1 },
                                moved: true,
                                click_count: n,
                                word_mode: false,
                                edge_dir: None,
                                start_abs_y: 0,
                                start_byte: 0,
                            });
                        } else {
                            self.sel.start_global(row, col);
                            self.sel.drag = Some(DragState {
                                mode: SelMode::Global,
                                start: CellPos { row, col },
                                end: CellPos { row, col },
                                moved: false,
                                click_count: n,
                                word_mode: false,
                                edge_dir: None,
                                start_abs_y: 0,
                                start_byte: 0,
                            });
                        }
                        set_pointer_shape("grab");
                    }
                }
            }

            MouseEventKind::Drag(MouseButton::Left) | MouseEventKind::Moved => {
                let is_drag = matches!(m.kind, MouseEventKind::Drag(MouseButton::Left));
                if !is_drag && self.sel.drag.is_none() {
                    self.update_hover(col, row);
                    return;
                }
                let Some(d) = self.sel.drag.as_mut() else {
                    return;
                };
                d.end = CellPos { row, col };
                if d.start.col.abs_diff(col) > INPUT_DRAG_THRESHOLD
                    || d.start.row.abs_diff(row) > 0
                {
                    d.moved = true;
                }
                let mode = d.mode;
                let word_mode = d.word_mode;
                let plain = self.scroll_plain.clone();
                match mode {
                    SelMode::Chat => {
                        let top = self.chat_inner.y;
                        let bot = self
                            .chat_inner
                            .y
                            .saturating_add(self.chat_inner.height.saturating_sub(1));
                        // Ink EDGE_ZONE: pin + auto-scroll when at/past viewport edges
                        let edge = if row <= top.saturating_add(mouse::EDGE_ZONE) || row < top {
                            Some(-1i8)
                        } else if row >= bot.saturating_sub(mouse::EDGE_ZONE) || row > bot {
                            Some(1i8)
                        } else {
                            None
                        };
                        if let Some(d) = self.sel.drag.as_mut() {
                            d.edge_dir = edge;
                        }
                        let ccol = self.screen_to_content_col(col);
                        if let Some(dir) = edge {
                            // pin end to edge absY (content-anchored)
                            let ay = pin_chat_edge_abs_y(
                                dir,
                                self.visible_start as i64,
                                self.chat_inner.height,
                            );
                            let pin_col = if word_mode {
                                if let Some(text) = plain.get(ay as usize) {
                                    plain_word_visual_cols(text, ccol as usize).1
                                } else {
                                    ccol
                                }
                            } else {
                                ccol
                            };
                            self.sel.update_chat_end(ay, pin_col, &plain);
                        } else if let Some(ay) =
                            screen_to_abs_y(row, self.chat_inner.y, self.visible_start)
                        {
                            let end_col = if word_mode {
                                if let Some(text) = plain.get(ay as usize) {
                                    plain_word_visual_cols(text, ccol as usize).1
                                } else {
                                    ccol
                                }
                            } else {
                                ccol
                            };
                            self.sel.update_chat_end(ay, end_col, &plain);
                        }
                        self.sel.capture_visible(
                            &self.chat_line_cache,
                            self.visible_start as i64,
                            self.chat_inner.y,
                        );
                        set_pointer_shape("grabbing");
                    }
                    SelMode::Global => {
                        if word_mode {
                            let (_, we) = vram_word_bounds(&self.vram, row, col);
                            self.sel.update_global_end(row, we);
                        } else {
                            self.sel.update_global_end(row, col);
                        }
                        set_pointer_shape("grabbing");
                    }
                    SelMode::Input => {
                        if !d.moved {
                            return;
                        }
                        // Ink: clamp drag to input rect
                        let ir = self.input_rect;
                        let text_x0 = self.input_text_x0();
                        let clamp_row = row.clamp(
                            ir.y,
                            ir.y.saturating_add(ir.height.saturating_sub(1)),
                        );
                        let clamp_col = col.clamp(
                            text_x0,
                            ir.x.saturating_add(ir.width.saturating_sub(1)).max(text_x0),
                        );
                        let vis_row = clamp_row.saturating_sub(ir.y) as usize;
                        let body_w = self.input_body_width();
                        let rows = input_display_rows(&self.input, body_w);
                        let view0 = input_view_start_with_offset(
                            &self.input,
                            self.cursor,
                            self.input_view_offset,
                            body_w,
                        );
                        let disp = view0 + vis_row;
                        let vcol = clamp_col.saturating_sub(text_x0) as usize;
                        let end_b =
                            display_row_visual_to_byte(&self.input, &rows, disp, vcol);
                        self.sel.update_input_end(end_b);
                        self.cursor = end_b;
                        set_pointer_shape("text");
                    }
                }
            }

            MouseEventKind::Up(MouseButton::Left) => {
                let plain = self.scroll_plain.clone();
                if let Some(d) = self.sel.drag.take() {
                    if d.moved || d.click_count >= 2 {
                        if d.mode == SelMode::Chat {
                            self.sel.capture_visible(
                                &self.chat_line_cache,
                                self.visible_start as i64,
                                self.chat_inner.y,
                            );
                        }
                        let lite = self.chrome.lite;
                        let t = self.sel.release_and_extract_opts(
                            &plain,
                            &self.chat_line_cache,
                            self.visible_start as i64,
                            &self.input,
                            &self.vram,
                            lite,
                        );
                        if !t.trim().is_empty() {
                            osc52_copy(&t);
                            self.toast_copy(&t);
                        } else {
                            // Ink: empty extract clears selection
                            self.sel.clear();
                        }
                    } else {
                        // pure click without move: drop zero-width sel (Ink-like)
                        self.sel.clear();
                    }
                }
                set_pointer_shape("default");
            }

            _ => {}
        }
    }

    pub(crate) fn update_hover(&mut self, col: u16, row: u16) {
        if self.chrome.lite {
            // LITE: skip hover highlight / pointer thrash
            return;
        }
        let mut id: Option<String> = None;
        if point_in_rect(col, row, self.chat_inner) {
            if let Some(cache_i) = self.chat_line_cache.iter().position(|(r, _, _)| *r == row)
            {
                let body_h = self.chat_inner.height as usize;
                let from_bottom =
                    (self.scroll_from_bottom as usize).min(self.max_scroll_lines);
                let end = self.scroll_plain.len().saturating_sub(from_bottom);
                let start = end.saturating_sub(body_h.max(1));
                let line_idx = start + cache_i;
                for th in &self.tool_hits {
                    if th.line_idx == line_idx {
                        id = Some(format!("tool:{}", th.tool_id));
                        break;
                    }
                }
                if id.is_none() {
                    for th in &self.thinking_hits {
                        if th.line_idx == line_idx {
                            id = Some(format!("think:{}", th.thinking_id));
                            break;
                        }
                    }
                }
                if id.is_none() {
                    for eh in &self.msg_expand_hits {
                        if eh.line_idx == line_idx {
                            id = Some(format!("expand:{}", eh.message_id));
                            break;
                        }
                    }
                }
                if id.is_none() {
                    for se in &self.system_event_hits {
                        if se.line_idx == line_idx {
                            id = Some(format!("sys:{}", se.event_id));
                            break;
                        }
                    }
                }
                if id.is_none() {
                    for tr in &self.tool_result_hits {
                        if tr.line_idx == line_idx {
                            id = Some(format!("toolres:{}", tr.tool_id));
                            break;
                        }
                    }
                }
            }
            if id.is_some() {
                set_pointer_shape("pointer");
            } else {
                set_pointer_shape("text");
            }
        } else if point_in_rect(col, row, self.input_rect) {
            set_pointer_shape("text");
        } else if point_in_rect(col, row, self.nav_rect) {
            // Ink NavBar: hoverId = segment id for recolor
            for (x0, x1, nid, _ak, _av) in &self.nav_segs {
                if col >= *x0 && col < *x1 {
                    id = Some(format!("nav:{nid}"));
                    break;
                }
            }
            set_pointer_shape("pointer");
        } else if self.back_to_bottom_y == Some(row)
            || self.jump_prev_y == Some(row)
            || self.overlay_rect.map(|r| point_in_rect(col, row, r)) == Some(true)
            || self.goal_rect.map(|r| point_in_rect(col, row, r)) == Some(true)
            || self.approval_rect.map(|r| point_in_rect(col, row, r)) == Some(true)
            || self.completion_rect.map(|r| point_in_rect(col, row, r)) == Some(true)
            || self.event_rect.map(|r| point_in_rect(col, row, r)) == Some(true)
        {
            set_pointer_shape("pointer");
        } else if self.streaming {
            set_pointer_shape("progress");
        } else {
            set_pointer_shape("default");
        }
        self.hover_id = id;
    }

}
