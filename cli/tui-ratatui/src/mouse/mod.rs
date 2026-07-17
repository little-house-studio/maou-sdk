//! Mouse selection + caret geometry (Ink useMouseInput / sel-fx parity).

mod clipboard;
mod controller;
mod helpers;
mod types;

pub use clipboard::{osc52_copy, set_pointer_shape};
pub use controller::SelController;
pub use helpers::*;
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vram::{Vram, VramCell};
    use ratatui::layout::Rect;
    use std::collections::HashMap;
    use unicode_width::UnicodeWidthStr;

    #[test]
    fn chat_extract_uses_line_cache_content() {
        let mut cache = HashMap::new();
        cache.insert(0, "  hello world".into());
        cache.insert(1, "  second line".into());
        let c = ChatSel {
            a_y: 0,
            a_col: 2,
            b_y: 1,
            b_col: 8,
            line_cache: cache,
        };
        let plain = vec!["  hello world".into(), "  second line".into()];
        let out = extract_chat_public(&c, &plain);
        assert!(out.contains("hello") || out.contains("second"), "got {out}");
        assert!(!out.is_empty());
    }

    #[test]
    fn input_extract_byte_range_only() {
        let mut sel = SelController::default();
        sel.active = Some(ActiveSel::Input(InputSel {
            start_byte: 0,
            end_byte: 5,
        }));
        sel.live();
        let vram = Vram::empty();
        let t = sel.extract(&[], &[], 0, "hello world", &vram);
        assert_eq!(t, "hello");
        // must not include prompt glyphs
        assert!(!t.contains('❯'));
    }

    #[test]
    fn global_extract_from_vram_cells() {
        let mut v = Vram {
            cols: 10,
            rows: 2,
            cells: vec![
                VramCell {
                    ch: " ".into(),
                    w: 1,
                };
                20
            ],
        };
        v.cells[0] = VramCell {
            ch: "A".into(),
            w: 1,
        };
        v.cells[1] = VramCell {
            ch: "B".into(),
            w: 1,
        };
        v.cells[10] = VramCell {
            ch: "C".into(),
            w: 1,
        };
        v.cells[11] = VramCell {
            ch: "D".into(),
            w: 1,
        };
        let mut sel = SelController::default();
        sel.start_global(0, 0);
        sel.update_global_end(1, 1);
        sel.live();
        let t = sel.extract(&[], &[], 0, "", &v);
        assert!(
            t.contains('A') && t.contains('D'),
            "global vram extract expected A..D got {t:?}"
        );
    }

    #[test]
    fn resolve_sel_mode_input_chat_global_order() {
        let chat = Rect {
            x: 1,
            y: 1,
            width: 40,
            height: 10,
        };
        let input = Rect {
            x: 0,
            y: 14,
            width: 80,
            height: 2,
        };
        assert_eq!(resolve_sel_mode(5, 14, chat, input), SelMode::Input);
        assert_eq!(resolve_sel_mode(5, 5, chat, input), SelMode::Chat);
        assert_eq!(resolve_sel_mode(5, 20, chat, input), SelMode::Global);
        // input wins even if overlapping hypothetically
        let overlap_input = Rect {
            x: 1,
            y: 5,
            width: 10,
            height: 1,
        };
        assert_eq!(
            resolve_sel_mode(2, 5, chat, overlap_input),
            SelMode::Input
        );
    }

    #[test]
    fn click_tracker_double_triple_window() {
        let mut t = ClickTracker::default();
        assert_eq!(t.register(10, 10), 1);
        assert_eq!(t.register(10, 10), 2); // same cell, immediate
        assert_eq!(t.register(10, 10), 3);
        assert_eq!(t.register(10, 10), 1); // wraps after 3
        // far click resets
        assert_eq!(t.register(50, 50), 1);
    }

    #[test]
    fn plain_word_and_line_visual_cols() {
        let text = "  hello_world  tail";
        let (a, b) = plain_word_visual_cols(text, 4); // on 'h' of hello
        let slice_start = visual_col_to_byte(text, a as usize);
        let slice_end = visual_col_to_byte(text, b as usize + 1);
        let word = &text[slice_start..slice_end.min(text.len())];
        assert!(
            word.contains("hello_world"),
            "word span got {word:?} cols {a}..{b}"
        );
        let (ls, le) = plain_line_visual_cols(text);
        assert!(le >= ls);
        assert!(le as usize <= UnicodeWidthStr::width(text).saturating_sub(1));
    }

    #[test]
    fn vram_word_and_line_bounds() {
        // row: "  foo-bar  "
        let mut cells = vec![
            VramCell {
                ch: " ".into(),
                w: 1,
            };
            12
        ];
        for (i, ch) in "  foo-bar  ".chars().enumerate() {
            cells[i] = VramCell {
                ch: ch.to_string(),
                w: 1,
            };
        }
        let v = Vram {
            cols: 12,
            rows: 1,
            cells,
        };
        let (ws, we) = vram_word_bounds(&v, 0, 3); // on 'f'
        let word: String = (ws..=we)
            .filter_map(|x| v.cell(x, 0).map(|c| c.ch.as_str()))
            .collect();
        assert_eq!(word, "foo", "got {word:?} {ws}..{we}");
        let (ls, le) = vram_line_bounds(&v, 0);
        let line: String = (ls..=le)
            .filter_map(|x| v.cell(x, 0).map(|c| c.ch.as_str()))
            .collect();
        assert!(line.contains("foo-bar"), "line {line:?}");
    }

    #[test]
    fn format_copy_toast_ink_wording_and_empty() {
        assert_eq!(format_copy_toast("   "), None);
        assert_eq!(format_copy_toast(""), None);
        let short = format_copy_toast("hi").unwrap();
        assert_eq!(short, "已复制 2 字");
        let long = "abcdefghijabcdefghijabcdeX"; // 26 chars
        let t = format_copy_toast(long).unwrap();
        assert!(t.starts_with("已复制 26 字「"), "{t}");
        assert!(t.contains('…'), "{t}");
    }

    #[test]
    fn format_screen_dump_toast_ink_wording() {
        assert_eq!(format_screen_dump_toast(""), None);
        assert_eq!(format_screen_dump_toast("  \n  "), None);
        let t = format_screen_dump_toast("ab\ncd").unwrap();
        assert_eq!(t, "已复制整屏 5 字（2 行）· 可粘贴发给 AI");
        // must NOT use selection-copy wording
        assert!(!t.contains('「'));
        assert!(t.contains("整屏") && t.contains("可粘贴发给 AI"));
    }

    #[test]
    fn resolve_wheel_target_priority_matches_ink() {
        assert_eq!(
            resolve_wheel_target(true, true, true, true, true),
            WheelTarget::FullEditor
        );
        assert_eq!(
            resolve_wheel_target(false, true, true, true, true),
            WheelTarget::Overlay
        );
        assert_eq!(
            resolve_wheel_target(false, false, true, true, true),
            WheelTarget::EventBlockExpanded
        );
        assert_eq!(
            resolve_wheel_target(false, false, false, true, true),
            WheelTarget::Completion
        );
        assert_eq!(
            resolve_wheel_target(false, false, false, false, true),
            WheelTarget::InputHistory
        );
        assert_eq!(
            resolve_wheel_target(false, false, false, false, false),
            WheelTarget::Chat
        );
    }

    #[test]
    fn shift_click_extends_chat_from_last_anchor() {
        let mut sel = SelController::default();
        let plain = vec![
            "line zero".into(),
            "line one here".into(),
            "line two".into(),
        ];
        sel.start_chat(0, 0, &plain);
        sel.update_chat_end(0, 4, &plain);
        let _ = sel.release_and_extract(&plain, &[], 0, "", &Vram::empty());
        // Shift-extend from stored anchor to line 2
        sel.start_chat_opts(2, 3, &plain, true);
        match &sel.active {
            Some(ActiveSel::Chat(c)) => {
                assert_eq!(c.a_y, 0, "anchor stays at first selection start");
                assert_eq!(c.b_y, 2);
            }
            other => panic!("expected chat sel, got {other:?}"),
        }
    }

    #[test]
    fn full_editor_preempts_stale_overlay_hits() {
        // Ink useMouseInput: fullEditorInitial checked before overlay scroll
        assert!(mouse_preempts_overlay(true));
        assert!(!mouse_preempts_overlay(false));
        // even with overlay "active" flags, wheel target is FullEditor
        assert_eq!(
            resolve_wheel_target(true, true, false, false, false),
            WheelTarget::FullEditor
        );
    }

    #[test]
    fn shift_cursor_line_moves_by_row() {
        let t = "aaa\nbbbb\nc";
        // cursor on first line col 2 (ASCII: codepoint col == byte col)
        let c0 = 2;
        let down = shift_cursor_line(t, c0, false);
        assert_eq!(down, 4 + 2); // after \n + 2 into bbbb
        assert!(t.is_char_boundary(down));
        let up = shift_cursor_line(t, down, true);
        assert_eq!(up, 2);
        assert!(t.is_char_boundary(up));
        // bottom clamps
        let end = shift_cursor_line(t, t.len(), false);
        assert_eq!(end, t.len());
        // top clamps
        assert_eq!(shift_cursor_line(t, 0, true), 0);
    }

    #[test]
    fn shift_cursor_line_cjk_never_mid_codepoint() {
        // skeptic: "ab\n你" with byte-col math put cursor mid-UTF-8 for 你
        let t = "ab\n你";
        assert_eq!("你".len(), 3);
        // end of "ab" (byte 2) → down: codepoint col=2 but next line has 1 cp → end of 你
        let down = shift_cursor_line(t, 2, false);
        assert!(
            t.is_char_boundary(down),
            "down from 'ab' must be char boundary, got {down} in {t:?}"
        );
        assert_eq!(down, t.len(), "clamp to end of short CJK line");
        // start of 你 (byte 3) → up: codepoint col=0 → start of "ab"
        let up = shift_cursor_line(t, 3, true);
        assert!(t.is_char_boundary(up));
        assert_eq!(up, 0);
        // mid-byte garbage index into 你 must snap before moving
        let mid = 4; // inside 你 (bytes 3..6)
        assert!(!t.is_char_boundary(mid));
        let fixed = shift_cursor_line(t, mid, true);
        assert!(t.is_char_boundary(fixed));
        assert_eq!(fixed, 0); // snapped to start of 你 then up → col0 of "ab"

        // preserve codepoint col across lines: after first CJK char → col 1 on ASCII
        let t2 = "你好\nabc";
        let after_ni = "你".len(); // 3
        assert!(t2.is_char_boundary(after_ni));
        let d2 = shift_cursor_line(t2, after_ni, false);
        assert!(t2.is_char_boundary(d2), "got {d2}");
        // col_cp=1 → 'b' of "abc"
        assert_eq!(d2, "你好\n".len() + 1);
        assert_eq!(&t2[d2..], "bc");
        let u2 = shift_cursor_line(t2, d2, true);
        assert!(t2.is_char_boundary(u2));
        assert_eq!(u2, after_ni); // back to after 你
    }

    #[test]
    fn byte_at_codepoint_col_and_snap() {
        let line = "你a好";
        assert_eq!(byte_at_codepoint_col(line, 0), 0);
        assert_eq!(byte_at_codepoint_col(line, 1), "你".len());
        assert_eq!(byte_at_codepoint_col(line, 2), "你a".len());
        assert_eq!(byte_at_codepoint_col(line, 99), line.len());
        let s = "xy你";
        assert_eq!(snap_char_boundary(s, 0), 0);
        assert_eq!(snap_char_boundary(s, 2), 2);
        // mid 你
        let mid = 3; // first byte of 你 at 2
        assert!(!s.is_char_boundary(mid) || mid == "xy".len()); // 你 starts at 2
        let ni = "xy".len();
        assert!(!s.is_char_boundary(ni + 1));
        assert_eq!(snap_char_boundary(s, ni + 1), ni);
    }

    #[test]
    fn safe_str_slice_never_panics_mid_utf8() {
        let s = "a你b";
        // layout: a(1) + 你(3) + b(1) → bytes [0]=a, [1..4)=你, [4]=b
        assert_eq!("a".len(), 1);
        assert_eq!("你".len(), 3);
        let mid_ni = 2; // second byte of 你
        assert!(!s.is_char_boundary(mid_ni));
        // snap mid_ni down to start of 你 (byte 1) → "你b"
        assert_eq!(safe_str_slice(s, mid_ni, s.len()), "你b");
        // whole string / single CJK / inverted / empty
        assert_eq!(safe_str_slice(s, 0, s.len()), "a你b");
        assert_eq!(safe_str_slice(s, 1, 1 + "你".len()), "你");
        assert_eq!(safe_str_slice(s, 10, 0), "a你b");
        assert_eq!(safe_str_slice("", 0, 0), "");
        assert_eq!(safe_str_slice(s, 0, 0), "");
    }

    #[test]
    fn byte_to_visual_col_mid_utf8_snaps_not_zero() {
        // a(1) + 你(display 2) + b → mid byte of 你 must snap to start of 你 → width of "a" = 1
        // (old bug: return 0 → caret jumps to line start)
        let s = "a你b";
        let mid = 2; // inside 你
        assert!(!s.is_char_boundary(mid));
        assert_eq!(byte_to_visual_col(s, mid), 1);
        assert_eq!(byte_to_visual_col(s, 1), 1); // start of 你
        assert_eq!(byte_to_visual_col(s, 0), 0);
        assert_eq!(byte_to_visual_col(s, s.len()), 1 + 2 + 1); // a + 你 + b
    }

    #[test]
    fn input_extract_snaps_mid_utf8_range() {
        let draft = "hi你there";
        // hi(2) + 你(3) + there…
        let start = 2; // after "hi", start of 你
        let mid = start + 1; // first continuation byte inside 你 — not a boundary
        assert!(!draft.is_char_boundary(mid));
        let mut sel = SelController::default();
        sel.active = Some(ActiveSel::Input(InputSel {
            start_byte: start,
            end_byte: mid, // true mid-UTF-8 end
        }));
        sel.live();
        let v = Vram::empty();
        let t = sel.extract(&[], &[], 0, draft, &v);
        // both ends snap to start of 你 → empty slice (a==b after snap)
        // OR if end snaps past: only valid UTF-8 "你" if end advanced — snap goes DOWN so empty
        assert_eq!(t, "", "mid-range inside one CJK char snaps to empty: got {t:?}");
        // wider mid range: start mid, end after 你
        let after_ni = start + "你".len();
        sel.active = Some(ActiveSel::Input(InputSel {
            start_byte: mid,
            end_byte: after_ni,
        }));
        let t2 = sel.extract(&[], &[], 0, draft, &v);
        assert_eq!(t2, "你", "snap start mid→你 start, end at char end: got {t2:?}");
    }

    #[test]
    fn input_view_start_mid_cursor_no_panic() {
        use crate::app::input_view_start;
        let draft = "1\n2\n3\n4\n5你";
        let mid = draft.len() - 1; // last byte of 你
        assert!(!draft.is_char_boundary(mid));
        let _ = input_view_start(draft, mid); // must not panic
        let start = input_view_start(draft, draft.len());
        assert!(start <= 1); // 6 lines, viewport 5 → start ≤ 1
    }

    #[test]
    fn should_paint_insert_caret_mutex_with_input_sel() {
        assert!(should_paint_insert_caret(None));
        assert!(should_paint_insert_caret(Some((2, 2)))); // zero-width
        assert!(!should_paint_insert_caret(Some((0, 4))));
        assert!(!should_paint_insert_caret(Some((5, 1))));
    }

    #[test]
    fn sel_style_colors_match_ink_sel_fx() {
        let (fg, bg) = sel_style_colors(SelPhase::Live);
        assert_eq!(bg, SEL_BG);
        assert_eq!(fg, SEL_FG);
        let (ffg, fbg) = sel_style_colors(SelPhase::Flash);
        assert_eq!(fbg, SEL_FLASH_BG);
        assert_eq!(ffg, SEL_FLASH_FG);
        let (sg, sb) = sel_style_colors(SelPhase::Settled);
        assert_eq!(sb, SEL_BG);
        assert_eq!(sg, SEL_FG);
    }

    #[test]
    fn sel_cell_style_is_solid_computer_blue() {
        use ratatui::style::{Color, Modifier};
        // live / settled：纯色 #2121FF + #EBEBEB，不依赖坐标
        for phase in [SelPhase::Live, SelPhase::Settled] {
            let st = sel_cell_style(phase);
            assert_eq!(st.bg, Some(SEL_BG.into()));
            assert_eq!(st.fg, Some(SEL_FG.into()));
            assert!(st.add_modifier.contains(Modifier::BOLD));
        }
        let Color::Rgb(r, g, b) = SEL_BG else { panic!("rgb") };
        assert_eq!((r, g, b), (0x21, 0x21, 0xff));
        let Color::Rgb(r, g, b) = SEL_FG else { panic!("rgb") };
        assert_eq!((r, g, b), (0xEB, 0xEB, 0xEB));
        let flash = sel_cell_style(SelPhase::Flash);
        assert_eq!(flash.bg, Some(SEL_FLASH_BG.into()));
        assert_eq!(flash.fg, Some(SEL_FLASH_FG.into()));
    }

    #[test]
    fn release_flash_then_settle_and_lite_settle() {
        let mut sel = SelController::default();
        sel.start_global(0, 0);
        sel.update_global_end(0, 2);
        let v = Vram::empty();
        let t = sel.release_and_extract_opts(&[], &[], 0, "", &v, false);
        let _ = t;
        assert_eq!(sel.phase, SelPhase::Flash);
        // lite path
        let mut sel2 = SelController::default();
        sel2.start_global(0, 0);
        sel2.update_global_end(0, 1);
        let _ = sel2.release_and_extract_opts(&[], &[], 0, "", &v, true);
        assert_eq!(sel2.phase, SelPhase::Settled);
    }

    #[test]
    fn zero_width_input_sel_has_no_range() {
        let mut sel = SelController::default();
        sel.start_input(3);
        assert!(sel.input_range().is_none());
        assert!(!sel.has_input_text_sel());
        assert_eq!(sel.phase, SelPhase::None); // no blue box
        sel.update_input_end(7);
        assert_eq!(sel.input_range(), Some((3, 7)));
        assert!(sel.has_input_text_sel());
        assert_eq!(sel.phase, SelPhase::Live);
    }

    #[test]
    fn pin_chat_edge_abs_y_top_bottom() {
        assert_eq!(pin_chat_edge_abs_y(-1, 100, 20), 100);
        assert_eq!(pin_chat_edge_abs_y(1, 100, 20), 119);
    }

    #[test]
    fn empty_chat_extract_is_empty_string() {
        let c = ChatSel {
            a_y: 0,
            a_col: 0,
            b_y: 0,
            b_col: 0,
            line_cache: HashMap::new(),
        };
        // zero-width on empty line → empty-ish
        let out = extract_chat_public(&c, &["".into()]);
        assert!(out.trim().is_empty() || out.is_empty(), "got {out:?}");
    }
}
