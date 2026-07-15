//! Layout tree: styles, slots, builder API.

use ratatui::layout::Rect;

/// Tagged region for paint / mouse lookup after solve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Slot {
    Root,
    Chat,
    ChatInner,
    JumpPrev,
    Goal,
    Approval,
    BackToBottom,
    Toast,
    EmptyHint,
    Completion,
    Event,
    Input,
    Info,
    Nav,
    /// Horizontal nav segment index (0..n).
    NavSeg(u16),
    Footer,
    Overlay,
    OverlayBody,
    FullEditor,
    FullEditorBody,
}

pub type NodeId = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Axis {
    #[default]
    Vertical,
    Horizontal,
}

impl Axis {
    pub fn is_vertical(self) -> bool {
        matches!(self, Axis::Vertical)
    }
}

/// Preferred size along one axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Length {
    /// Exactly N cells.
    Fixed(u16),
    /// Flex item: preferred `basis`, then grow/shrink among siblings.
    Flex { grow: u16, shrink: u16, basis: u16 },
    /// Call [`Measure::content_size`] (width, height) and take main-axis component.
    Content,
    /// Percentage of parent **inner** main size (0–100).
    Percent(u16),
    /// Stretch to fill parent cross axis; on main axis treated as Flex grow 0 basis 0
    /// unless the node has flex children (then sizes to children).
    Auto,
}

impl Default for Length {
    fn default() -> Self {
        Length::Auto
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Edges {
    pub top: u16,
    pub right: u16,
    pub bottom: u16,
    pub left: u16,
}

impl Edges {
    pub const ZERO: Edges = Edges {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    };

    pub fn all(v: u16) -> Self {
        Self {
            top: v,
            right: v,
            bottom: v,
            left: v,
        }
    }

    pub fn vh(v: u16, h: u16) -> Self {
        Self {
            top: v,
            bottom: v,
            left: h,
            right: h,
        }
    }

    pub fn main_sum(self, axis: Axis) -> u16 {
        if axis.is_vertical() {
            self.top.saturating_add(self.bottom)
        } else {
            self.left.saturating_add(self.right)
        }
    }

    pub fn cross_sum(self, axis: Axis) -> u16 {
        if axis.is_vertical() {
            self.left.saturating_add(self.right)
        } else {
            self.top.saturating_add(self.bottom)
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Style {
    pub axis: Axis,
    pub width: Length,
    pub height: Length,
    pub min_width: u16,
    pub min_height: u16,
    pub max_width: u16,
    pub max_height: u16,
    pub padding: Edges,
    pub visible: bool,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            axis: Axis::Vertical,
            width: Length::Auto,
            height: Length::Auto,
            min_width: 0,
            min_height: 0,
            max_width: u16::MAX,
            max_height: u16::MAX,
            padding: Edges::ZERO,
            visible: true,
        }
    }
}

impl Style {
    pub fn column() -> Self {
        Self {
            axis: Axis::Vertical,
            ..Self::default()
        }
    }

    pub fn row() -> Self {
        Self {
            axis: Axis::Horizontal,
            ..Self::default()
        }
    }

    pub fn width(mut self, w: Length) -> Self {
        self.width = w;
        self
    }

    pub fn height(mut self, h: Length) -> Self {
        self.height = h;
        self
    }

    pub fn min_height(mut self, h: u16) -> Self {
        self.min_height = h;
        self
    }

    pub fn min_width(mut self, w: u16) -> Self {
        self.min_width = w;
        self
    }

    pub fn max_height(mut self, h: u16) -> Self {
        self.max_height = h;
        self
    }

    pub fn padding(mut self, p: Edges) -> Self {
        self.padding = p;
        self
    }

    pub fn hidden(mut self) -> Self {
        self.visible = false;
        self
    }

    pub fn visible_if(mut self, on: bool) -> Self {
        self.visible = on;
        self
    }
}

/// Content-driven sizing hook (slot → (width, height) preference).
pub trait Measure {
    fn content_size(&self, slot: Slot, max_w: u16, max_h: u16) -> (u16, u16);
}

/// No-op measure (all content sizes 0).
pub struct NullMeasure;
impl Measure for NullMeasure {
    fn content_size(&self, _slot: Slot, _max_w: u16, _max_h: u16) -> (u16, u16) {
        (0, 0)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Node {
    pub style: Style,
    pub slot: Option<Slot>,
    pub children: Vec<NodeId>,
    pub parent: Option<NodeId>,
}

#[derive(Debug, Default)]
pub struct Tree {
    pub(crate) nodes: Vec<Node>,
    pub(crate) root: Option<NodeId>,
}

impl Tree {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn root(&mut self, style: Style) -> NodeId {
        let id = self.alloc(Node {
            style,
            slot: Some(Slot::Root),
            children: Vec::new(),
            parent: None,
        });
        self.root = Some(id);
        id
    }

    pub fn child(&mut self, parent: NodeId, slot: Option<Slot>, style: Style) -> NodeId {
        let id = self.alloc(Node {
            style,
            slot,
            children: Vec::new(),
            parent: Some(parent),
        });
        self.nodes[parent as usize].children.push(id);
        id
    }

    fn alloc(&mut self, node: Node) -> NodeId {
        let id = self.nodes.len() as NodeId;
        self.nodes.push(node);
        id
    }

    pub fn solve(&self, viewport: Rect, measure: &dyn Measure) -> crate::layout::Solved {
        crate::layout::solve::solve_tree(self, viewport, measure)
    }
}

/// Clamp size into [min, max].
pub(crate) fn clamp_size(v: u16, min: u16, max: u16) -> u16 {
    v.max(min).min(max)
}

/// Extract main-axis component of a Length given parent main size and measure.
pub(crate) fn resolve_length(
    len: Length,
    parent_main: u16,
    min: u16,
    max: u16,
    slot: Option<Slot>,
    vertical: bool,
    measure: &dyn Measure,
    max_cross: u16,
) -> (u16, u16, u16) {
    // returns (preferred, grow, shrink)
    match len {
        Length::Fixed(n) => (clamp_size(n, min, max), 0, 0),
        Length::Flex { grow, shrink, basis } => (clamp_size(basis, min, max), grow, shrink),
        Length::Percent(p) => {
            let n = (parent_main as u32 * p.min(100) as u32 / 100) as u16;
            (clamp_size(n, min, max), 0, 0)
        }
        Length::Content => {
            let (w, h) = if let Some(s) = slot {
                measure.content_size(s, if vertical { max_cross } else { parent_main }, if vertical { parent_main } else { max_cross })
            } else {
                (0, 0)
            };
            let n = if vertical { h } else { w };
            (clamp_size(n, min, max), 0, 0)
        }
        Length::Auto => (clamp_size(0, min, max), 0, 0),
    }
}
