//! Terminal integer flex layout engine — element geometry bottom layer.
//!
//! # Model
//! - **Box tree** of nodes with column/row axis, padding, grow/shrink, min/max.
//! - **Integer cells** only (`u16` / `Rect`) — no float flex rounding.
//! - **Slots** tag nodes the paint/mouse layer looks up after `solve`.
//! - **Content measure** is injected via [`Measure`] (engine never knows messages/theme).
//!
//! # Adding a region
//! 1. Add a [`Slot`] variant (or reuse `Custom`).
//! 2. Attach it when building the tree (`Tree::child(..., Some(Slot::…), …)`).
//! 3. If height/width is content-driven, handle it in your [`Measure`] impl.
//! 4. After `solve`, `solved.get(Slot::…)` → paint into that `Rect`.
//!
//! Shell wiring lives in [`shell`].

mod shell;
mod solve;
mod tree;

pub use shell::{build_shell_tree, solve_shell, ShellMetrics};
pub use solve::{place_absolute_center, Solved};
// re-export for draw absolute helpers
pub use tree::{Axis, Edges, Length, Measure, NodeId, Slot, Style, Tree};

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::layout::Rect;
    use std::collections::HashMap;

    struct FixedMeasure {
        map: HashMap<Slot, (u16, u16)>,
    }

    impl Measure for FixedMeasure {
        fn content_size(&self, slot: Slot, _max_w: u16, _max_h: u16) -> (u16, u16) {
            self.map.get(&slot).copied().unwrap_or((0, 0))
        }
    }

    #[test]
    fn vertical_flex_grow_fills_remainder() {
        let mut t = Tree::new();
        let root = t.root(Style::column());
        t.child(
            root,
            Some(Slot::Chat),
            Style::column()
                .height(Length::Flex {
                    grow: 1,
                    shrink: 0,
                    basis: 0,
                })
                .min_height(3),
        );
        t.child(
            root,
            Some(Slot::Input),
            Style::column().height(Length::Fixed(2)),
        );
        t.child(
            root,
            Some(Slot::Nav),
            Style::column().height(Length::Fixed(1)),
        );

        let m = FixedMeasure {
            map: HashMap::new(),
        };
        let s = t.solve(Rect::new(0, 0, 80, 24), &m);
        let chat = s.get(Slot::Chat).unwrap();
        let input = s.get(Slot::Input).unwrap();
        let nav = s.get(Slot::Nav).unwrap();
        assert_eq!(chat.height, 21); // 24 - 2 - 1
        assert_eq!(input.height, 2);
        assert_eq!(nav.height, 1);
        assert_eq!(chat.y, 0);
        assert_eq!(input.y, 21);
        assert_eq!(nav.y, 23);
        assert_eq!(chat.width, 80);
    }

    #[test]
    fn hidden_nodes_take_zero_space() {
        let mut t = Tree::new();
        let root = t.root(Style::column());
        t.child(
            root,
            Some(Slot::Chat),
            Style::column().height(Length::Flex {
                grow: 1,
                shrink: 0,
                basis: 0,
            }),
        );
        t.child(
            root,
            Some(Slot::Toast),
            Style::column().height(Length::Fixed(1)).hidden(),
        );
        t.child(
            root,
            Some(Slot::Nav),
            Style::column().height(Length::Fixed(1)),
        );
        let m = FixedMeasure {
            map: HashMap::new(),
        };
        let s = t.solve(Rect::new(0, 0, 40, 10), &m);
        assert!(s.get(Slot::Toast).is_none());
        assert_eq!(s.get(Slot::Chat).unwrap().height, 9);
        assert_eq!(s.get(Slot::Nav).unwrap().height, 1);
    }

    #[test]
    fn padding_creates_inner_child_rect() {
        let mut t = Tree::new();
        let root = t.root(Style::column());
        let chat = t.child(
            root,
            Some(Slot::Chat),
            Style::column()
                .height(Length::Flex {
                    grow: 1,
                    shrink: 0,
                    basis: 0,
                })
                .padding(Edges::all(1)),
        );
        t.child(
            chat,
            Some(Slot::ChatInner),
            Style::column().height(Length::Flex {
                grow: 1,
                shrink: 0,
                basis: 0,
            }),
        );
        let m = FixedMeasure {
            map: HashMap::new(),
        };
        let s = t.solve(Rect::new(0, 0, 20, 12), &m);
        let outer = s.get(Slot::Chat).unwrap();
        let inner = s.get(Slot::ChatInner).unwrap();
        assert_eq!(outer, Rect::new(0, 0, 20, 12));
        assert_eq!(inner, Rect::new(1, 1, 18, 10));
    }

    #[test]
    fn horizontal_equal_grow() {
        let mut t = Tree::new();
        let root = t.root(Style::row().height(Length::Fixed(1)));
        for i in 0..4u16 {
            t.child(
                root,
                Some(Slot::NavSeg(i)),
                Style::row().width(Length::Flex {
                    grow: 1,
                    shrink: 1,
                    basis: 0,
                }),
            );
        }
        let m = FixedMeasure {
            map: HashMap::new(),
        };
        let s = t.solve(Rect::new(0, 0, 40, 1), &m);
        let mut widths = Vec::new();
        for i in 0..4u16 {
            let r = s.get(Slot::NavSeg(i)).unwrap();
            widths.push(r.width);
            assert_eq!(r.height, 1);
            assert_eq!(r.y, 0);
        }
        assert_eq!(widths.iter().sum::<u16>(), 40);
        // equal grow → 10 each (Ink base/rem, not leftover-on-last)
        assert!(widths.iter().all(|&w| w == 10), "{widths:?}");
    }

    #[test]
    fn horizontal_equal_grow_remainder_on_first() {
        // 43 / 4 → base 10, rem 3 → [11,11,11,10] (Ink NavBar), not [10,10,10,13]
        let mut t = Tree::new();
        let root = t.root(Style::row().height(Length::Fixed(1)));
        for i in 0..4u16 {
            t.child(
                root,
                Some(Slot::NavSeg(i)),
                Style::row().width(Length::Flex {
                    grow: 1,
                    shrink: 1,
                    basis: 0,
                }),
            );
        }
        let m = FixedMeasure {
            map: HashMap::new(),
        };
        let s = t.solve(Rect::new(0, 0, 43, 1), &m);
        let widths: Vec<u16> = (0..4)
            .map(|i| s.get(Slot::NavSeg(i)).unwrap().width)
            .collect();
        assert_eq!(widths, vec![11, 11, 11, 10], "{widths:?}");
        assert_eq!(widths.iter().sum::<u16>(), 43);
    }

    #[test]
    fn content_measure_height() {
        let mut t = Tree::new();
        let root = t.root(Style::column());
        t.child(
            root,
            Some(Slot::Chat),
            Style::column().height(Length::Flex {
                grow: 1,
                shrink: 0,
                basis: 0,
            }),
        );
        t.child(
            root,
            Some(Slot::Event),
            Style::column().height(Length::Content),
        );
        let mut map = HashMap::new();
        map.insert(Slot::Event, (0u16, 5u16));
        let m = FixedMeasure { map };
        let s = t.solve(Rect::new(0, 0, 80, 20), &m);
        assert_eq!(s.get(Slot::Event).unwrap().height, 5);
        assert_eq!(s.get(Slot::Chat).unwrap().height, 15);
    }

    #[test]
    fn absolute_center_helper() {
        let parent = Rect::new(0, 0, 100, 40);
        let r = place_absolute_center(parent, 60, 20);
        assert_eq!(r, Rect::new(20, 10, 60, 20));
    }

    #[test]
    fn min_height_respected_when_squeezed() {
        let mut t = Tree::new();
        let root = t.root(Style::column());
        t.child(
            root,
            Some(Slot::Chat),
            Style::column()
                .height(Length::Flex {
                    grow: 1,
                    shrink: 1,
                    basis: 0,
                })
                .min_height(3),
        );
        t.child(
            root,
            Some(Slot::Input),
            Style::column().height(Length::Fixed(8)),
        );
        // viewport 10: preferred input 8 + chat min 3 = 11 > 10 → shrink chat but not below 3;
        // may overflow slightly — engine clamps chat to min and shortens if needed
        let m = FixedMeasure {
            map: HashMap::new(),
        };
        let s = t.solve(Rect::new(0, 0, 40, 10), &m);
        assert!(s.get(Slot::Chat).unwrap().height >= 3);
    }

    #[test]
    fn shell_tree_assigns_chat_input_nav() {
        let m = ShellMetrics {
            has_goal: false,
            goal_h: 0,
            has_approval: false,
            has_toast: false,
            show_back: false,
            show_jump: false,
            empty_hint: false,
            show_comp: false,
            comp_h: 0,
            event_h: 1,
            input_h: 2,
            show_info: true,
            nav_seg_count: 7,
            overlay_w: 0,
            overlay_h: 0,
            full_editor: false,
        };
        let s = solve_shell(&m, Rect::new(0, 0, 80, 30));
        let chat = s.get(Slot::Chat).expect("chat");
        let inner = s.get(Slot::ChatInner).expect("inner");
        let input = s.get(Slot::Input).expect("input");
        let nav = s.get(Slot::Nav).expect("nav");
        assert!(chat.height >= 3, "chat h={}", chat.height);
        assert_eq!(input.height, 2);
        assert_eq!(nav.height, 1);
        // 无外框：ChatInner 与 Chat 同原点（仅 JumpPrev 时高度不同）
        assert_eq!(inner.x, chat.x);
        assert_eq!(inner.y, chat.y);
        // chrome: no jump when show_jump=false → back(1)+event(1)+input(2)+info(1)+nav(1)=6
        assert_eq!(
            chat.height + 1 + 1 + 2 + 1 + 1,
            30,
            "vertical stack fills (no JumpPrev when not scrolling)"
        );
        assert!(s.get(Slot::JumpPrev).is_none(), "jump hidden when show_jump=false");
        assert_eq!(chat.y, 0, "chat starts at top when no jump bar");
        let mut nav_w = 0u16;
        for i in 0..7 {
            nav_w += s.get(Slot::NavSeg(i)).expect("seg").width;
        }
        assert_eq!(nav_w, nav.width);
    }

    #[test]
    fn shell_hides_event_when_completion() {
        let m = ShellMetrics {
            has_goal: false,
            goal_h: 0,
            has_approval: false,
            has_toast: false,
            show_back: false,
            show_jump: false,
            empty_hint: false,
            show_comp: true,
            comp_h: 4,
            event_h: 0,
            input_h: 1,
            show_info: false,
            nav_seg_count: 7,
            overlay_w: 40,
            overlay_h: 12,
            full_editor: false,
        };
        let s = solve_shell(&m, Rect::new(0, 0, 100, 40));
        assert!(s.get(Slot::Event).is_none());
        assert!(s.get(Slot::Info).is_none());
        assert_eq!(s.get(Slot::Completion).unwrap().height, 4);
        let ov = s.get(Slot::Overlay).unwrap();
        assert_eq!(ov.width, 40);
        assert_eq!(ov.height, 12);
        assert!(ov.x > 0 && ov.y > 0);
    }
}
