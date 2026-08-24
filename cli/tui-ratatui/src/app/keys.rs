//! Keyboard handling .

use super::App;
use super::LocalToast;
use super::text_util::{next_char_boundary, prev_char_boundary};
use crate::mouse::{self, osc52_copy, set_pointer_shape};
use crate::protocol::{emit, OutMsg};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::time::{Duration, Instant};

impl App {
    /// 在 overlay 列表中移动选择；agents 页跳过 header/spacer。
    fn overlay_move_sel(&mut self, dir: i32, skip_headers: bool) {
        let Some(o) = self.overlay.as_ref() else {
            return;
        };
        let n = o.items.len();
        if n == 0 {
            return;
        }
        let mut i = self.overlay_sel as i32;
        for _ in 0..n {
            i += dir;
            if i < 0 {
                i = (n - 1) as i32;
            } else if i >= n as i32 {
                i = 0;
            }
            let it = &o.items[i as usize];
            let selectable = it.selectable.unwrap_or(true);
            let kind = it.row_kind.as_deref().unwrap_or("");
            if skip_headers && (kind == "header" || kind == "spacer" || !selectable) {
                continue;
            }
            self.overlay_sel = i as usize;
            return;
        }
    }

    pub fn on_key(&mut self, key: KeyEvent) {
        // 任意按键 = 用户在场 → 停 Node 卡住长铃
        self.emit_user_activity("key");
        // full editor mode — expanded to match InputBar + FSE basics
        if self.full_editor {
            self.on_key_full_editor(key);
            return;
        }

        // terminal approval first — trap focus: arrows cycle chips, 1-4 / YANB / Enter confirm
        if self.terminal_approval.is_some() {
            let order = ["y", "a", "n", "b"];
            let cycle = |cur: Option<&str>, dir: i32| -> &'static str {
                let i = cur
                    .and_then(|c| order.iter().position(|&x| x == c))
                    .unwrap_or(0) as i32;
                let n = order.len() as i32;
                let j = ((i + dir) % n + n) % n;
                order[j as usize]
            };
            match key.code {
                KeyCode::Left | KeyCode::Up => {
                    self.approval_hover =
                        Some(cycle(self.approval_hover.as_deref(), -1).into());
                    return;
                }
                KeyCode::Right | KeyCode::Down | KeyCode::Tab => {
                    self.approval_hover =
                        Some(cycle(self.approval_hover.as_deref(), 1).into());
                    return;
                }
                KeyCode::Enter => {
                    let c = self
                        .approval_hover
                        .clone()
                        .unwrap_or_else(|| "y".into());
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval { id, choice: c });
                    self.approval_hover = None;
                    return;
                }
                KeyCode::Char('1') => {
                    self.approval_hover = Some("y".into());
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval {
                        id,
                        choice: "y".into(),
                    });
                    return;
                }
                KeyCode::Char('2') => {
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval {
                        id,
                        choice: "a".into(),
                    });
                    return;
                }
                KeyCode::Char('3') | KeyCode::Esc => {
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval {
                        id,
                        choice: "n".into(),
                    });
                    return;
                }
                KeyCode::Char('4') => {
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval {
                        id,
                        choice: "b".into(),
                    });
                    return;
                }
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval {
                        id,
                        choice: "y".into(),
                    });
                    return;
                }
                KeyCode::Char('a') | KeyCode::Char('A') => {
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval {
                        id,
                        choice: "a".into(),
                    });
                    return;
                }
                KeyCode::Char('n') | KeyCode::Char('N') => {
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval {
                        id,
                        choice: "n".into(),
                    });
                    return;
                }
                KeyCode::Char('b') | KeyCode::Char('B') => {
                    let id = self
                        .terminal_approval
                        .as_ref()
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    emit(&OutMsg::Approval {
                        id,
                        choice: "b".into(),
                    });
                    return;
                }
                // 审批中吞掉其它键，避免误发消息
                _ => return,
            }
        }

        // overlay
        if self.overlay.is_some() {
            let is_agents = self.overlay.as_ref().map(|o| o.kind.as_str()) == Some("agents");
            match key.code {
                KeyCode::Esc => {
                    emit(&OutMsg::Escape);
                    return;
                }
                KeyCode::Up => {
                    self.overlay_move_sel(-1, is_agents);
                    return;
                }
                KeyCode::Down => {
                    self.overlay_move_sel(1, is_agents);
                    return;
                }
                KeyCode::Enter => {
                    if let Some(o) = &self.overlay {
                        if o.items.is_empty() {
                            emit(&OutMsg::OverlayAction {
                                action: "close".into(),
                                value: None,
                            });
                        } else if let Some(it) = o.items.get(self.overlay_sel) {
                            let selectable = it.selectable.unwrap_or(true);
                            if !selectable {
                                return;
                            }
                            emit(&OutMsg::OverlayAction {
                                action: "select".into(),
                                value: Some(it.value.clone()),
                            });
                        }
                    }
                    return;
                }
                KeyCode::Char('s') | KeyCode::Char('S') if is_agents => {
                    if let Some(o) = &self.overlay {
                        if let Some(it) = o.items.get(self.overlay_sel) {
                            if it.can_stop.unwrap_or(false) {
                                emit(&OutMsg::OverlayAction {
                                    action: "stop".into(),
                                    value: Some(it.value.clone()),
                                });
                            }
                        }
                    }
                    return;
                }
                KeyCode::Char('d') | KeyCode::Char('D') if is_agents => {
                    if let Some(o) = &self.overlay {
                        if let Some(it) = o.items.get(self.overlay_sel) {
                            if it.can_delete.unwrap_or(false) {
                                emit(&OutMsg::OverlayAction {
                                    action: "delete".into(),
                                    value: Some(it.value.clone()),
                                });
                            }
                        }
                    }
                    return;
                }
                KeyCode::Right if is_agents => {
                    emit(&OutMsg::Escape);
                    return;
                }
                _ => {}
            }
            return;
        }

        // Cmd+C / meta+c — copy selection only (no quit arm)
        if (key.modifiers.contains(KeyModifiers::SUPER)
            || key.modifiers.contains(KeyModifiers::META))
            && matches!(key.code, KeyCode::Char('c') | KeyCode::Char('C'))
        {
            let _ = self.copy_active_selection();
            return;
        }

        // global hotkeys
        if key.modifiers.contains(KeyModifiers::CONTROL) {
            match key.code {
                KeyCode::Char('c') | KeyCode::Char('C') => {
                    // Ctrl+Shift+C → copy any selection (chat/global/input)
                    if key.modifiers.contains(KeyModifiers::SHIFT) {
                        let _ = self.copy_active_selection();
                        return;
                    }
                    // bare Ctrl+C: copy input/FSE sel only, else quit-arm stack
                    if self.copy_input_selection() {
                        return;
                    }
                    let now = Instant::now();
                    if self.completions.is_some()
                        || self.overlay.is_some()
                        || self.terminal_approval.is_some()
                        || self.streaming
                    {
                        emit(&OutMsg::Escape);
                        if self.streaming {
                            emit(&OutMsg::Abort);
                        }
                        self.ctrl_c_armed = true;
                        self.ctrl_c_at = now;
                        return;
                    }
                    if self.ctrl_c_armed && now.duration_since(self.ctrl_c_at).as_secs() < 3 {
                        emit(&OutMsg::Quit);
                        self.should_quit = true;
                    } else {
                        self.ctrl_c_armed = true;
                        self.ctrl_c_at = now;
                        self.status = "再按一次 Ctrl+C 退出".into();
                        emit(&OutMsg::Log {
                            text: "ctrl-c arm".into(),
                        });
                    }
                    return;
                }
                KeyCode::Char('k') => {
                    emit(&OutMsg::Hotkey {
                        key: "ctrl+k".into(),
                    });
                    return;
                }
                KeyCode::Char('m') => {
                    emit(&OutMsg::Hotkey {
                        key: "ctrl+m".into(),
                    });
                    return;
                }
                KeyCode::Char(',') => {
                    emit(&OutMsg::Hotkey {
                        key: "ctrl+,".into(),
                    });
                    return;
                }
                KeyCode::Char('n') => {
                    emit(&OutMsg::Hotkey {
                        key: "ctrl+n".into(),
                    });
                    return;
                }
                KeyCode::Char('e') => {
                    emit(&OutMsg::OpenFullEditor);
                    return;
                }
                // Ctrl+R：重试最近一次 API/系统错误对应的用户消息
                KeyCode::Char('r') | KeyCode::Char('R') => {
                    if !self.streaming {
                        emit(&OutMsg::Retry { event_id: None });
                    }
                    return;
                }
                KeyCode::Char('g') | KeyCode::Char('\\') => {
                    let dump = self.screen_dump_text();
                    let already = if let Some(msg) = mouse::format_screen_dump_toast(&dump) {
                        osc52_copy(&dump);
                        self.local_toast = Some(LocalToast {
                            text: msg,
                            kind: "ok".into(),
                            until: Instant::now() + Duration::from_millis(2200),
                        });
                        true
                    } else {
                        false
                    };
                    emit(&OutMsg::ScreenDump {
                        text: if dump.trim().is_empty() {
                            None
                        } else {
                            Some(dump)
                        },
                        already_copied: already,
                    });
                    return;
                }
                KeyCode::Char('s') => {
                    emit(&OutMsg::SoundToggle);
                    return;
                }
                KeyCode::Char('w') => {
                    self.delete_word();
                    return;
                }
                KeyCode::Char(c) => {
                    // 未占用的 Ctrl[+Shift|+Alt]+键交给 Node（扩展 registerShortcut）
                    let mut combo = String::from("ctrl");
                    if key.modifiers.contains(KeyModifiers::SHIFT) {
                        combo.push_str("+shift");
                    }
                    if key.modifiers.contains(KeyModifiers::ALT) {
                        combo.push_str("+alt");
                    }
                    combo.push('+');
                    combo.push(c.to_ascii_lowercase());
                    emit(&OutMsg::Hotkey { key: combo });
                    return;
                }
                _ => {}
            }
        }

        if key.code == KeyCode::Esc {
            if self.sel.active.is_some() || self.sel.drag.is_some() {
                self.sel.clear();
                set_pointer_shape("default");
                return;
            }
            // Goal 详情是本地浮层：Esc 先收它，不该穿到 Node 去中断任务
            if self.close_goal_detail() {
                return;
            }
            emit(&OutMsg::Escape);
            return;
        }

        if key.code == KeyCode::BackTab
            || (key.code == KeyCode::Tab && key.modifiers.contains(KeyModifiers::SHIFT))
        {
            emit(&OutMsg::SetApprovalMode { mode: None });
            return;
        }

        // completion nav — : Enter/Tab accept, ↑↓ cycle (do NOT submit on Enter)
        if self
            .completions
            .as_ref()
            .map(|c| !c.items.is_empty())
            .unwrap_or(false)
        {
            match key.code {
                KeyCode::Up => {
                    emit(&OutMsg::CompleteCycle { dir: "up".into() });
                    return;
                }
                KeyCode::Down => {
                    emit(&OutMsg::CompleteCycle {
                        dir: "down".into(),
                    });
                    return;
                }
                KeyCode::Tab | KeyCode::Enter => {
                    // Enter with open menu = accept 
                    if key.code == KeyCode::Enter
                        && key.modifiers.contains(KeyModifiers::ALT)
                    {
                        // Alt+Enter still newline even with menu
                        self.insert_str("\n");
                        return;
                    }
                    emit(&OutMsg::CompleteAccept);
                    return;
                }
                KeyCode::Esc => {
                    emit(&OutMsg::Escape);
                    return;
                }
                _ => {}
            }
        }

        match key.code {
            // ignore function keys / media (no junk insert)
            KeyCode::F(_)
            | KeyCode::Null
            | KeyCode::CapsLock
            | KeyCode::ScrollLock
            | KeyCode::NumLock
            | KeyCode::PrintScreen
            | KeyCode::Pause
            | KeyCode::Menu
            | KeyCode::KeypadBegin => {}
            KeyCode::Enter => {
                // Alt+Enter / Option+Enter newline
                if key.modifiers.contains(KeyModifiers::ALT) {
                    self.insert_str("\n");
                    return;
                }
                let text = self.input.clone();
                if text.trim().is_empty() {
                    return;
                }
                // 乐观插入 user 气泡：不必等 Node 往返才更新对话区
                let id = format!(
                    "local-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_nanos())
                        .unwrap_or(0)
                );
                self.messages.push(crate::protocol::UiMessage {
                    id,
                    role: "user".into(),
                    content: text.clone(),
                    ts: Some(
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0),
                    ),
                    streaming: false,
                    tools: vec![],
                    tool_cards: vec![],
                    thinking_blocks: vec![],
                    duration_ms: None,
                    round: None,
                    kind: Some("human_user".into()),
                    author_label: None,
                    usage_input: None,
                    usage_output: None,
                });
                self.scroll_render_cache = None;
                self.pin_follow_for_send();
                emit(&OutMsg::Submit { text });
                self.input.clear();
                self.cursor = 0;
                self.input_view_offset = None;
                self.completions = None;
                self.sel.clear();
            }
            KeyCode::Backspace => {
                if key.modifiers.contains(KeyModifiers::CONTROL) {
                    self.delete_sentence();
                } else if key.modifiers.contains(KeyModifiers::ALT) {
                    self.delete_word();
                } else {
                    self.backspace();
                }
            }
            KeyCode::Delete => {
                self.delete_forward();
            }
            KeyCode::Left => {
                if self.collapse_input_sel(false) {
                    self.emit_input();
                    return;
                }
                if self.cursor == 0 && self.input.is_empty() {
                    emit(&OutMsg::Hotkey {
                        key: "open_agents".into(),
                    });
                } else {
                    self.cursor = prev_char_boundary(&self.input, self.cursor);
                    self.emit_input();
                }
            }
            KeyCode::Right => {
                if self.collapse_input_sel(true) {
                    self.emit_input();
                    return;
                }
                self.cursor = next_char_boundary(&self.input, self.cursor);
                self.emit_input();
            }
            KeyCode::Up => {
                if self.collapse_input_sel(false) {
                    self.emit_input();
                    return;
                }
                // 显示行（含 soft-wrap）第一行再 ↑ → 历史
                if self.cursor_display_row() == 0 {
                    emit(&OutMsg::History { dir: "up".into() });
                } else if self.shift_input_display_row(true) {
                    self.emit_input();
                }
            }
            KeyCode::Down => {
                if self.collapse_input_sel(true) {
                    self.emit_input();
                    return;
                }
                // 显示行末行再 ↓ → 历史；中间按 soft-wrap 行移动
                if self.shift_input_display_row(false) {
                    self.emit_input();
                } else {
                    emit(&OutMsg::History {
                        dir: "down".into(),
                    });
                }
            }
            KeyCode::PageUp => {
                self.apply_scroll_lines(8);
            }
            KeyCode::PageDown => {
                self.apply_scroll_lines(-8);
            }
            // Home/End = current line (not document)
            KeyCode::Home => self.move_home_line(),
            KeyCode::End => self.move_end_line(),
            KeyCode::Char(c) => {
                self.ctrl_c_armed = false;
                self.insert_str(&c.to_string());
            }
            _ => {}
        }
    }

    fn on_key_full_editor(&mut self, key: KeyEvent) {
        if key.modifiers.contains(KeyModifiers::CONTROL) && matches!(key.code, KeyCode::Char('c')) {
            if let Some((a, b)) = self.sel.input_range() {
                let src = &self.full_editor_text;
                let lo = mouse::snap_char_boundary(src, a.min(b).min(src.len()));
                let hi = mouse::snap_char_boundary(src, a.max(b).min(src.len()));
                if lo < hi {
                    let slice = src[lo..hi].to_string();
                    osc52_copy(&slice);
                    self.toast_copy(&slice);
                    return;
                }
            }
        }
        match key.code {
            KeyCode::Esc => {
                self.full_editor = false;
                self.sel.clear();
                self.input = self.full_editor_text.clone();
                self.cursor = self.input.len();
                emit(&OutMsg::FullEditorDone {
                    text: self.full_editor_text.clone(),
                    submit: false,
                });
            }
            KeyCode::Char('s') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.full_editor = false;
                self.pin_follow_for_send();
                emit(&OutMsg::FullEditorDone {
                    text: self.full_editor_text.clone(),
                    submit: true,
                });
                self.input.clear();
                self.cursor = 0;
            }
            KeyCode::Enter => {
                self.fe_insert_str("\n");
            }
            KeyCode::Backspace => {
                if key.modifiers.contains(KeyModifiers::CONTROL) {
                    self.fe_delete_sentence();
                } else if key.modifiers.contains(KeyModifiers::ALT) {
                    self.fe_delete_word();
                } else {
                    self.fe_backspace();
                }
            }
            KeyCode::Delete => self.fe_delete_forward(),
            KeyCode::Up => {
                self.full_editor_cursor = mouse::shift_cursor_line(
                    &self.full_editor_text,
                    self.full_editor_cursor,
                    true,
                );
            }
            KeyCode::Down => {
                self.full_editor_cursor = mouse::shift_cursor_line(
                    &self.full_editor_text,
                    self.full_editor_cursor,
                    false,
                );
            }
            KeyCode::Left => {
                let c = mouse::snap_char_boundary(
                    &self.full_editor_text,
                    self.full_editor_cursor.min(self.full_editor_text.len()),
                );
                self.full_editor_cursor = prev_char_boundary(&self.full_editor_text, c);
            }
            KeyCode::Right => {
                let c = mouse::snap_char_boundary(
                    &self.full_editor_text,
                    self.full_editor_cursor.min(self.full_editor_text.len()),
                );
                self.full_editor_cursor = next_char_boundary(&self.full_editor_text, c);
            }
            KeyCode::Home => self.fe_home_line(),
            KeyCode::End => self.fe_end_line(),
            KeyCode::Char(c) if key.modifiers.contains(KeyModifiers::CONTROL) => {
                if c == 'w' {
                    self.fe_delete_word();
                }
            }
            KeyCode::Char(c) => {
                self.fe_insert_str(&c.to_string());
            }
            _ => {}
        }
    }

    /// Bracketed paste entry (from Event::Paste).
    pub fn on_paste(&mut self, text: String) {
        if self.full_editor {
            self.fe_insert_str(&text);
            return;
        }
        if self.overlay.is_some() || self.terminal_approval.is_some() {
            return;
        }
        self.ctrl_c_armed = false;
        self.paste_str(&text);
    }
}
