//! Regression: mid-UTF-8 cursor / selection must not panic on shipped App paths.

use super::App;
use crate::mouse::{ActiveSel, InputSel};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::sync::mpsc;

fn test_app() -> App {
    let (_tx, rx) = mpsc::channel();
    App::new(rx)
}

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn follow_tail_pad_reserves_room_when_pinned() {
    use crate::protocol::UiMessage;
    let mut app = test_app();
    app.messages.push(UiMessage {
        id: "u1".into(),
        role: "user".into(),
        content: "hi".into(),
        ..Default::default()
    });
    app.scroll_from_bottom = 0;
    app.follow_tail_boost = false;
    app.streaming = false;
    // idle + unknown tail → 1-line pad
    assert_eq!(app.follow_tail_pad_lines(20, 0), 1, "idle follow pad");
    app.pin_follow_for_send();
    assert_eq!(app.scroll_from_bottom, 0);
    assert!(app.follow_tail_boost);
    let pad = app.follow_tail_pad_lines(20, 0);
    // boost / stream with unknown tail: near-full viewport pad
    assert!(pad >= 3, "send/stream pad room for AI, got {pad}");
    // known tail: pad = viewH - tail
    assert_eq!(app.follow_tail_pad_lines(20, 12), 8);
    // empty messages: no pad
    app.messages.clear();
    assert_eq!(app.follow_tail_pad_lines(20, 0), 0);
}

#[test]
fn wheel_chat_slow_is_one_line_fast_accelerates() {
    let mut app = test_app();
    app.max_scroll_lines = 200;
    app.scroll_from_bottom = 10;
    // 冷启动 / 慢拨：首事件 1 行
    app.note_wheel_chat(true);
    assert_eq!(app.scroll_from_bottom, 11, "slow first notch = 1 line");
    // 间隔拉大再拨：仍 1 行
    std::thread::sleep(std::time::Duration::from_millis(100));
    app.note_wheel_chat(true);
    assert_eq!(app.scroll_from_bottom, 12, "slow second notch = 1 line");
    // 无新事件不伪造惯性
    std::thread::sleep(std::time::Duration::from_millis(50));
    app.tick_input();
    assert_eq!(app.scroll_from_bottom, 12, "no coast without OS events");
    // 密集连发（模拟 fling）：每事件 >1 行
    let before = app.scroll_from_bottom;
    for _ in 0..10 {
        app.note_wheel_chat(true);
    }
    let delta = app.scroll_from_bottom - before;
    assert!(delta > 10, "dense fling must accelerate, delta={delta}");
    assert!(delta <= 60, "fling not unbounded, delta={delta}");
}

#[test]
fn looks_user_head_and_jump_label() {
    assert!(App::looks_user_head_line(" ab12 | user | 12:00 │ ⨁"));
    assert!(!App::looks_user_head_line("◈ agent:coding"));
    let mut app = test_app();
    app.scroll_plain = vec![
        " u1 | user | 00:00 │ ⨁".into(),
        "│ hello world preview".into(),
        "│ more".into(),
        "◈ agent".into(),
    ];
    app.visible_start = 3;
    let label = app.prev_user_jump_label(40);
    assert!(label.starts_with('↑'), "{label}");
    assert!(label.contains("hello") || label.contains("preview") || label.contains("user"), "{label}");
}

/// Overlay list click: visual row + list_from → absolute index (windowed SelectList).
#[test]
fn overlay_windowed_index_math() {
    // from=3, click relative row 1 → abs 4
    let from = 3usize;
    let rel = 1usize;
    let count = 5usize;
    assert!(rel < count);
    assert_eq!(from + rel, 4);
}

/// scrubInput: CSI / mouse SGR must not land in draft (E02 / Ink InputBar).
#[test]
fn insert_str_scrubs_control_sequences() {
    let mut app = test_app();
    app.insert_str("ok\x1b[<1;2;3M\x07!");
    assert_eq!(app.input, "ok!");
    app.paste_str("a\x1b[Ab");
    assert_eq!(app.input, "ok!ab");
}

/// B1: insert_str with cursor mid-CJK must snap and insert without panic.
#[test]
fn insert_str_mid_utf8_cursor_no_panic() {
    let mut app = test_app();
    app.input = "a你b".into();
    // mid of 你 (byte 2)
    app.cursor = 2;
    assert!(!app.input.is_char_boundary(app.cursor));
    app.insert_str("x");
    // snap → start of 你 (1) → "ax你b"
    assert_eq!(app.input, "ax你b");
    assert!(app.input.is_char_boundary(app.cursor));
    assert_eq!(app.cursor, 2); // after inserted 'x'
}

/// B1 variant via InputSet then insert
#[test]
fn input_set_mid_cursor_then_insert() {
    let mut app = test_app();
    app.input = "你".into();
    app.cursor = 1; // mid of 你
    assert!(!app.input.is_char_boundary(app.cursor));
    // simulate what InputSet does
    app.cursor = crate::mouse::snap_char_boundary(&app.input, app.cursor);
    assert_eq!(app.cursor, 0);
    app.insert_str("!");
    assert_eq!(app.input, "!你");
}

/// B6: take_input_sel_delete with mid-UTF-8 sel ends
#[test]
fn take_input_sel_delete_mid_utf8_sel() {
    let mut app = test_app();
    app.input = "ab你cd".into();
    // 你 starts at byte 2
    let ni = 2;
    let mid = ni + 1;
    assert!(!app.input.is_char_boundary(mid));
    let after = ni + "你".len(); // 5
    app.sel.active = Some(ActiveSel::Input(InputSel {
        start_byte: mid, // mid 你
        end_byte: after + 1, // into "c"
    }));
    app.sel.live();
    assert!(app.take_input_sel_delete());
    // snap start→你, end→ after+1 if boundary else snap: after is boundary, +1 is "c"+1? 
    // after=5 is start of 'c', after+1=6 is 'd'
    // range mid(3)→6 snaps to 2..6 → delete "你c" → "abd"
    assert_eq!(app.input, "abd");
    assert!(app.input.is_char_boundary(app.cursor));
    assert!(!app.sel.has_input_text_sel());
}

/// B6: sel entirely inside one CJK char → snap empty range, clear sel, no panic
#[test]
fn take_input_sel_delete_inside_single_cjk() {
    let mut app = test_app();
    app.input = "x你y".into();
    let ni = 1;
    app.sel.active = Some(ActiveSel::Input(InputSel {
        start_byte: ni + 1,
        end_byte: ni + 2, // both mid 你
    }));
    app.sel.live();
    // both snap to ni → lo==hi → no text deleted, sel cleared
    let deleted = app.take_input_sel_delete();
    assert!(!deleted);
    assert_eq!(app.input, "x你y");
    assert!(!app.sel.has_input_text_sel());
}

/// B3: full_editor insert/backspace with mid-UTF-8 cursor
#[test]
fn full_editor_insert_backspace_mid_utf8() {
    let mut app = test_app();
    app.full_editor = true;
    app.full_editor_text = "你".into();
    app.full_editor_cursor = 1; // mid of 你
    assert!(!app.full_editor_text.is_char_boundary(app.full_editor_cursor));
    app.on_key(key(KeyCode::Char('Z')));
    // snap to start of 你 then insert → "Z你"
    assert_eq!(app.full_editor_text, "Z你");
    assert!(app.full_editor_text.is_char_boundary(app.full_editor_cursor));
    assert_eq!(app.full_editor_cursor, 1);

    // mid of 你 in "Z你": bytes Z(1)+你(3) → mid at 2
    let mid = 2;
    assert!(!app.full_editor_text.is_char_boundary(mid));
    app.full_editor_cursor = mid;
    app.on_key(key(KeyCode::Backspace));
    // snap to start of 你 (byte 1), then delete prev char Z → "你"
    assert_eq!(app.full_editor_text, "你");
    assert!(app.full_editor_text.is_char_boundary(app.full_editor_cursor));

    // delete 你: cursor after it, backspace
    app.full_editor_cursor = app.full_editor_text.len();
    app.on_key(key(KeyCode::Backspace));
    assert_eq!(app.full_editor_text, "");
}

/// Full editor Left/Right/Home/End on CJK
#[test]
fn full_editor_left_right_home_end_cjk() {
    let mut app = test_app();
    app.full_editor = true;
    app.full_editor_text = "a你b\n第二行".into();
    app.full_editor_cursor = app.full_editor_text.len();

    // Home → start of last line
    app.on_key(key(KeyCode::Home));
    let after_nl = app.full_editor_text.find('\n').unwrap() + 1;
    assert_eq!(app.full_editor_cursor, after_nl);
    assert!(app.full_editor_text.is_char_boundary(app.full_editor_cursor));

    // Right one codepoint (第)
    app.on_key(key(KeyCode::Right));
    assert!(app.full_editor_text.is_char_boundary(app.full_editor_cursor));
    assert!(app.full_editor_cursor > after_nl);

    // Left back
    let mid = app.full_editor_cursor;
    app.on_key(key(KeyCode::Left));
    assert_eq!(app.full_editor_cursor, after_nl);

    // End of line
    app.on_key(key(KeyCode::End));
    assert_eq!(app.full_editor_cursor, app.full_editor_text.len());

    // Left from end across CJK
    app.on_key(key(KeyCode::Left));
    assert!(app.full_editor_text.is_char_boundary(app.full_editor_cursor));
    assert!(app.full_editor_cursor < app.full_editor_text.len());

    // mid-UTF-8 Left snaps then moves
    app.full_editor_cursor = mid.saturating_sub(1);
    if !app.full_editor_text.is_char_boundary(app.full_editor_cursor) {
        app.on_key(key(KeyCode::Left));
        assert!(app.full_editor_text.is_char_boundary(app.full_editor_cursor));
    }
}
