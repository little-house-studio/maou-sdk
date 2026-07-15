//! Keyboard handling (Ink keybindings parity).

use super::App;
use super::LocalToast;
use super::text_util::{next_char_boundary, prev_char_boundary};
use crate::mouse::{self, osc52_copy, set_pointer_shape};
use crate::protocol::{emit, OutMsg};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::time::{Duration, Instant};

impl App {
    pub fn on_key(&mut self, key: KeyEvent) {
        // full editor mode — expanded to match InputBar + FSE basics
        if self.full_editor {
            self.on_key_full_editor(key);
            return;
        }

        // terminal approval first
        if self.terminal_approval.is_some() {
            match key.code {
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
                KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
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
                _ => {}
            }
        }

        // overlay
        if self.overlay.is_some() {
            match key.code {
                KeyCode::Esc => {
                    emit(&OutMsg::Escape);
                    return;
                }
                KeyCode::Up => {
                    self.overlay_sel = self.overlay_sel.saturating_sub(1);
                    return;
                }
                KeyCode::Down => {
                    if let Some(o) = &self.overlay {
                        if !o.items.is_empty() {
                            self.overlay_sel = (self.overlay_sel + 1).min(o.items.len() - 1);
                        }
                    }
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
                            emit(&OutMsg::OverlayAction {
                                action: "select".into(),
                                value: Some(it.value.clone()),
                            });
                        }
                    }
                    return;
                }
                KeyCode::Right
                    if self.overlay.as_ref().map(|o| o.kind.as_str()) == Some("agents") =>
                {
                    emit(&OutMsg::Escape);
                    return;
                }
                _ => {}
            }
            return;
        }

        // Ink: Cmd+C / meta+c — copy selection only (no quit arm)
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
                    // Ink: Ctrl+Shift+C → copy any selection (chat/global/input)
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
                _ => {}
            }
        }

        if key.code == KeyCode::Esc {
            if self.sel.active.is_some() || self.sel.drag.is_some() {
                self.sel.clear();
                set_pointer_shape("default");
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

        // completion nav — Ink: Enter/Tab accept, ↑↓ cycle (do NOT submit on Enter)
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
                    // Enter with open menu = accept (Ink doSubmit early return)
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
            // Ink useCleanInput: ignore function keys / media (no junk insert)
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
                // Grok/Ink: send while following → pin latest + reserve tail for AI stream
                // (even if scrolled slightly, send jumps to bottom like chat apps)
                self.pin_follow_for_send();
                emit(&OutMsg::Submit { text });
                self.input.clear();
                self.cursor = 0;
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
                // history if single line or first line
                if !self.input.contains('\n') || self.cursor_line() == 0 {
                    emit(&OutMsg::History { dir: "up".into() });
                } else {
                    self.cursor = mouse::shift_cursor_line(&self.input, self.cursor, true);
                    self.emit_input();
                }
            }
            KeyCode::Down => {
                if self.collapse_input_sel(true) {
                    self.emit_input();
                    return;
                }
                // Ink: last-line Down → history; mid multi-line moves caret
                if !self.input.contains('\n') {
                    emit(&OutMsg::History {
                        dir: "down".into(),
                    });
                } else {
                    let before = self.cursor;
                    self.cursor = mouse::shift_cursor_line(&self.input, self.cursor, false);
                    // if already last line (cursor unchanged), try history
                    if self.cursor == before {
                        emit(&OutMsg::History {
                            dir: "down".into(),
                        });
                    } else {
                        self.emit_input();
                    }
                }
            }
            KeyCode::PageUp => {
                self.apply_scroll_lines(8);
            }
            KeyCode::PageDown => {
                self.apply_scroll_lines(-8);
            }
            // Ink: Home/End = current line (not document)
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
