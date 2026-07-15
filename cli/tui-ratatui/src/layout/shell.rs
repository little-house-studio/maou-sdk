//! Shell layout tree — Ink `Layout.tsx` structure as integer flex.

use super::solve::{place_absolute_center, Solved};
use super::tree::{Edges, Length, Measure, Slot, Style, Tree};
use ratatui::layout::Rect;

/// Pure inputs for shell geometry (no App borrow needed during solve).
#[derive(Debug, Clone)]
pub struct ShellMetrics {
    pub has_goal: bool,
    pub goal_h: u16,
    pub has_approval: bool,
    pub has_toast: bool,
    pub show_back: bool, // visual only; slot always 1 row
    pub show_jump: bool,
    pub empty_hint: bool,
    pub show_comp: bool,
    pub comp_h: u16,
    pub event_h: u16, // 0 = hidden
    pub input_h: u16,
    pub show_info: bool,
    pub nav_seg_count: u16,
    /// Overlay box size (0 width = no overlay).
    pub overlay_w: u16,
    pub overlay_h: u16,
    pub full_editor: bool,
}

impl ShellMetrics {
    pub fn nav_count() -> u16 {
        7 // agent sessions terminal todo inbox notice settings
    }
}

struct ShellMeasure<'a> {
    m: &'a ShellMetrics,
}

impl Measure for ShellMeasure<'_> {
    fn content_size(&self, slot: Slot, _max_w: u16, _max_h: u16) -> (u16, u16) {
        let h = match slot {
            Slot::Goal => self.m.goal_h,
            Slot::Approval => 2,
            Slot::BackToBottom => 1,
            Slot::Toast => 1,
            Slot::EmptyHint => 2,
            Slot::Completion => self.m.comp_h,
            Slot::Event => self.m.event_h,
            Slot::Input => self.m.input_h,
            Slot::Info => 1,
            Slot::Nav => 1,
            _ => 0,
        };
        (0, h)
    }
}

/// Build Ink-aligned shell tree.
pub fn build_shell_tree(m: &ShellMetrics) -> Tree {
    let mut t = Tree::new();

    if m.full_editor {
        let root = t.root(Style::column());
        let fe = t.child(
            root,
            Some(Slot::FullEditor),
            Style::column()
                .height(Length::Flex {
                    grow: 1,
                    shrink: 0,
                    basis: 0,
                })
                .padding(Edges::all(1)),
        );
        t.child(
            fe,
            Some(Slot::FullEditorBody),
            Style::column().height(Length::Flex {
                grow: 1,
                shrink: 0,
                basis: 0,
            }),
        );
        return t;
    }

    let root = t.root(Style::column());

    // Chat (border = padding 1) flexGrow 1 min 3
    let chat = t.child(
        root,
        Some(Slot::Chat),
        Style::column()
            .height(Length::Flex {
                grow: 1,
                shrink: 0,
                basis: 0,
            })
            .min_height(3)
            .padding(Edges::all(1)),
    );
    // Jump prev bar inside chat content
    t.child(
        chat,
        Some(Slot::JumpPrev),
        Style::column()
            .height(Length::Fixed(1))
            .visible_if(m.show_jump),
    );
    t.child(
        chat,
        Some(Slot::ChatInner),
        Style::column()
            .height(Length::Flex {
                grow: 1,
                shrink: 0,
                basis: 0,
            })
            .min_height(1),
    );

    t.child(
        root,
        Some(Slot::Goal),
        Style::column()
            .height(Length::Content)
            .visible_if(m.has_goal),
    );
    t.child(
        root,
        Some(Slot::Approval),
        Style::column()
            .height(Length::Fixed(2))
            .visible_if(m.has_approval),
    );
    // Always 1 row (Ink BackToBottomSlot)
    t.child(
        root,
        Some(Slot::BackToBottom),
        Style::column().height(Length::Fixed(1)),
    );
    let _ = m.show_back; // paint decides label; space always reserved

    t.child(
        root,
        Some(Slot::Toast),
        Style::column()
            .height(Length::Fixed(1))
            .visible_if(m.has_toast),
    );
    t.child(
        root,
        Some(Slot::EmptyHint),
        Style::column()
            .height(Length::Fixed(2))
            .visible_if(m.empty_hint),
    );

    // Footer chrome
    let footer = t.child(
        root,
        Some(Slot::Footer),
        Style::column().height(Length::Auto),
    );
    t.child(
        footer,
        Some(Slot::Completion),
        Style::column()
            .height(Length::Content)
            .visible_if(m.show_comp),
    );
    t.child(
        footer,
        Some(Slot::Event),
        Style::column()
            .height(Length::Content)
            .visible_if(m.event_h > 0),
    );
    t.child(
        footer,
        Some(Slot::Input),
        Style::column().height(Length::Content),
    );
    t.child(
        footer,
        Some(Slot::Info),
        Style::column()
            .height(Length::Fixed(1))
            .visible_if(m.show_info),
    );
    let nav = t.child(
        footer,
        Some(Slot::Nav),
        Style::row().height(Length::Fixed(1)),
    );
    let n = if m.nav_seg_count == 0 {
        ShellMetrics::nav_count()
    } else {
        m.nav_seg_count
    };
    for i in 0..n {
        t.child(
            nav,
            Some(Slot::NavSeg(i)),
            Style::row().width(Length::Flex {
                grow: 1,
                shrink: 1,
                basis: 0,
            }),
        );
    }

    t
}

/// Solve shell + optional overlay absolute rect.
pub fn solve_shell(m: &ShellMetrics, viewport: Rect) -> Solved {
    let tree = build_shell_tree(m);
    let measure = ShellMeasure { m };
    let mut solved = tree.solve(viewport, &measure);

    if m.overlay_w > 0 && m.overlay_h > 0 && !m.full_editor {
        let r = place_absolute_center(viewport, m.overlay_w, m.overlay_h);
        solved.insert(Slot::Overlay, r);
        // body = inner of border
        let body = Rect {
            x: r.x.saturating_add(1),
            y: r.y.saturating_add(1),
            width: r.width.saturating_sub(2),
            height: r.height.saturating_sub(2),
        };
        solved.insert(Slot::OverlayBody, body);
    }

    solved
}
