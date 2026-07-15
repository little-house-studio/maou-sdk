//! Measure → allocate → place.

use super::tree::{clamp_size, Axis, Length, Measure, NodeId, Slot, Tree};
use ratatui::layout::Rect;
use std::collections::HashMap;

#[derive(Debug, Default, Clone)]
pub struct Solved {
    rects: HashMap<Slot, Rect>,
}

impl Solved {
    pub fn get(&self, slot: Slot) -> Option<Rect> {
        self.rects.get(&slot).copied()
    }

    pub fn insert(&mut self, slot: Slot, r: Rect) {
        self.rects.insert(slot, r);
    }

    pub fn rects(&self) -> &HashMap<Slot, Rect> {
        &self.rects
    }
}

/// Center a box of size (w,h) inside `parent` (Ink-style absolute overlay).
pub fn place_absolute_center(parent: Rect, w: u16, h: u16) -> Rect {
    let w = w.min(parent.width);
    let h = h.min(parent.height);
    let x = parent.x.saturating_add(parent.width.saturating_sub(w) / 2);
    let y = parent.y.saturating_add(parent.height.saturating_sub(h) / 2);
    Rect::new(x, y, w, h)
}

pub fn solve_tree(tree: &Tree, viewport: Rect, measure: &dyn Measure) -> Solved {
    let mut out = Solved::default();
    let Some(root) = tree.root else {
        return out;
    };
    layout_node(tree, root, viewport, measure, &mut out);
    out
}

fn layout_node(
    tree: &Tree,
    id: NodeId,
    rect: Rect,
    measure: &dyn Measure,
    out: &mut Solved,
) {
    let node = &tree.nodes[id as usize];
    if !node.style.visible {
        return;
    }
    if let Some(slot) = node.slot {
        out.insert(slot, rect);
    }

    let pad = node.style.padding;
    let inner = Rect {
        x: rect.x.saturating_add(pad.left),
        y: rect.y.saturating_add(pad.top),
        width: rect
            .width
            .saturating_sub(pad.left.saturating_add(pad.right)),
        height: rect
            .height
            .saturating_sub(pad.top.saturating_add(pad.bottom)),
    };

    let kids: Vec<NodeId> = node
        .children
        .iter()
        .copied()
        .filter(|&c| tree.nodes[c as usize].style.visible)
        .collect();
    if kids.is_empty() {
        return;
    }

    let axis = node.style.axis;
    let vertical = axis.is_vertical();
    let main_size = if vertical { inner.height } else { inner.width };
    let cross_size = if vertical { inner.width } else { inner.height };

    // Preferred main sizes + flex factors
    let mut preferred: Vec<u16> = Vec::with_capacity(kids.len());
    let mut grows: Vec<u16> = Vec::with_capacity(kids.len());
    let mut shrinks: Vec<u16> = Vec::with_capacity(kids.len());
    let mut mins: Vec<u16> = Vec::with_capacity(kids.len());
    let mut maxs: Vec<u16> = Vec::with_capacity(kids.len());

    for &cid in &kids {
        let c = &tree.nodes[cid as usize];
        let (main_len, min_main, max_main) = if vertical {
            (c.style.height, c.style.min_height, c.style.max_height)
        } else {
            (c.style.width, c.style.min_width, c.style.max_width)
        };

        // If Content and has children, prefer summing children? For leaf Content use measure.
        // Nested: if Length::Auto/Flex basis 0 with children-only sizing — first resolve length.
        let (pref, grow, shrink) = resolve_child_main(
            tree,
            cid,
            main_len,
            main_size,
            min_main,
            max_main,
            vertical,
            cross_size,
            measure,
        );
        preferred.push(pref);
        grows.push(grow);
        shrinks.push(shrink);
        mins.push(min_main);
        maxs.push(max_main);
    }

    let mut sizes = preferred.clone();
    let sum: u32 = sizes.iter().map(|&s| s as u32).sum();
    let main_u = main_size as u32;

    if sum < main_u {
        let free = (main_u - sum) as u16;
        let grow_total: u32 = grows.iter().map(|&g| g as u32).sum();
        if grow_total > 0 {
            let flex_idx: Vec<usize> = grows
                .iter()
                .enumerate()
                .filter(|(_, g)| **g > 0)
                .map(|(i, _)| i)
                .collect();
            // Equal grow (all grow==1): Ink NavBar style —
            // base = free/n, first (free%n) items get +1 (NOT dump remainder on last).
            let all_equal = flex_idx.iter().all(|&i| grows[i] == grows[flex_idx[0]]);
            let mut allocated = 0u16;
            if all_equal && !flex_idx.is_empty() {
                let n = flex_idx.len() as u16;
                let base = free / n;
                let rem = free % n;
                for (k, &i) in flex_idx.iter().enumerate() {
                    let extra = base + if (k as u16) < rem { 1 } else { 0 };
                    let next = sizes[i].saturating_add(extra).min(maxs[i]);
                    allocated = allocated.saturating_add(next.saturating_sub(sizes[i]));
                    sizes[i] = next;
                }
            } else {
                for (k, &i) in flex_idx.iter().enumerate() {
                    let extra = if k + 1 == flex_idx.len() {
                        free.saturating_sub(allocated)
                    } else {
                        ((free as u32 * grows[i] as u32) / grow_total) as u16
                    };
                    let next = sizes[i].saturating_add(extra).min(maxs[i]);
                    allocated = allocated.saturating_add(next.saturating_sub(sizes[i]));
                    sizes[i] = next;
                }
            }
            // leftover free (due to max clamps) → round-robin first growable under max
            let mut leftover = free.saturating_sub(allocated);
            while leftover > 0 {
                let mut progressed = false;
                for &i in &flex_idx {
                    if sizes[i] < maxs[i] && leftover > 0 {
                        sizes[i] += 1;
                        leftover -= 1;
                        progressed = true;
                    }
                }
                if !progressed {
                    break;
                }
            }
        }
    } else if sum > main_u {
        let mut overflow = (sum - main_u) as u16;
        // shrink proportional
        while overflow > 0 {
            let shrink_total: u32 = shrinks
                .iter()
                .enumerate()
                .filter(|(i, s)| **s > 0 && sizes[*i] > mins[*i])
                .map(|(_, s)| *s as u32)
                .sum();
            if shrink_total == 0 {
                // force shrink from end (chrome first would be reverse — shrink any above min)
                let mut progressed = false;
                for i in (0..sizes.len()).rev() {
                    if sizes[i] > mins[i] && overflow > 0 {
                        sizes[i] -= 1;
                        overflow -= 1;
                        progressed = true;
                    }
                }
                if !progressed {
                    break;
                }
                continue;
            }
            let mut step_done = 0u16;
            for i in 0..sizes.len() {
                if shrinks[i] == 0 || sizes[i] <= mins[i] || overflow == 0 {
                    continue;
                }
                let cut = ((overflow as u32 * shrinks[i] as u32) / shrink_total)
                    .max(1) as u16;
                let room = sizes[i] - mins[i];
                let cut = cut.min(room).min(overflow);
                sizes[i] -= cut;
                overflow -= cut;
                step_done += cut;
            }
            if step_done == 0 {
                break;
            }
        }
    }

    // Place along main axis
    let mut cursor_main = if vertical { inner.y } else { inner.x };
    for (i, &cid) in kids.iter().enumerate() {
        let c = &tree.nodes[cid as usize];
        let main = sizes[i];
        let (cross_len, min_cross, max_cross) = if vertical {
            (c.style.width, c.style.min_width, c.style.max_width)
        } else {
            (c.style.height, c.style.min_height, c.style.max_height)
        };
        let child_cross = resolve_cross(
            cross_len,
            cross_size,
            min_cross,
            max_cross,
            c.slot,
            vertical,
            measure,
            main,
        );

        let child_rect = if vertical {
            Rect {
                x: inner.x,
                y: cursor_main,
                width: child_cross.min(cross_size).max(min_cross).min(max_cross),
                height: main,
            }
        } else {
            Rect {
                x: cursor_main,
                y: inner.y,
                width: main,
                height: child_cross.min(cross_size).max(min_cross).min(max_cross),
            }
        };
        // Stretch cross: if Auto/Percent full, use full cross_size
        let child_rect = stretch_cross(child_rect, inner, vertical, cross_len);

        layout_node(tree, cid, child_rect, measure, out);
        cursor_main = cursor_main.saturating_add(main);
    }
}

fn stretch_cross(mut r: Rect, inner: Rect, vertical: bool, cross_len: Length) -> Rect {
    match cross_len {
        Length::Auto | Length::Flex { .. } => {
            if vertical {
                r.x = inner.x;
                r.width = inner.width;
            } else {
                r.y = inner.y;
                r.height = inner.height;
            }
            r
        }
        _ => r,
    }
}

fn resolve_cross(
    len: Length,
    parent_cross: u16,
    min: u16,
    max: u16,
    slot: Option<Slot>,
    parent_vertical: bool,
    measure: &dyn Measure,
    main_size: u16,
) -> u16 {
    // cross axis: for vertical parent, cross is width
    match len {
        Length::Fixed(n) => clamp_size(n, min, max),
        Length::Percent(p) => {
            let n = (parent_cross as u32 * p.min(100) as u32 / 100) as u16;
            clamp_size(n, min, max)
        }
        Length::Content => {
            let (w, h) = if let Some(s) = slot {
                if parent_vertical {
                    measure.content_size(s, parent_cross, main_size)
                } else {
                    measure.content_size(s, main_size, parent_cross)
                }
            } else {
                (0, 0)
            };
            let n = if parent_vertical { w } else { h };
            if n == 0 {
                clamp_size(parent_cross, min, max)
            } else {
                clamp_size(n, min, max)
            }
        }
        Length::Flex { basis, .. } if basis > 0 => clamp_size(basis, min, max),
        Length::Auto | Length::Flex { .. } => clamp_size(parent_cross, min, max),
    }
}

fn resolve_child_main(
    tree: &Tree,
    id: NodeId,
    len: Length,
    parent_main: u16,
    min: u16,
    max: u16,
    vertical: bool,
    parent_cross: u16,
    measure: &dyn Measure,
) -> (u16, u16, u16) {
    let node = &tree.nodes[id as usize];
    match len {
        Length::Fixed(n) => (clamp_size(n, min, max), 0, 0),
        Length::Flex { grow, shrink, basis } => {
            // If basis 0 and has children with fixed sizes, sum children as basis-like preferred
            let pref = if basis == 0 && !node.children.is_empty() && grow == 0 {
                sum_children_preferred(tree, id, vertical, parent_main, parent_cross, measure)
                    .max(min)
                    .min(max)
            } else {
                clamp_size(basis, min, max)
            };
            (pref, grow, shrink)
        }
        Length::Percent(p) => {
            let n = (parent_main as u32 * p.min(100) as u32 / 100) as u16;
            (clamp_size(n, min, max), 0, 0)
        }
        Length::Content => {
            let (w, h) = if let Some(s) = node.slot {
                measure.content_size(
                    s,
                    if vertical { parent_cross } else { parent_main },
                    if vertical { parent_main } else { parent_cross },
                )
            } else {
                (0, 0)
            };
            let mut n = if vertical { h } else { w };
            if n == 0 && !node.children.is_empty() {
                n = sum_children_preferred(tree, id, vertical, parent_main, parent_cross, measure);
            }
            (clamp_size(n, min, max), 0, 0)
        }
        Length::Auto => {
            if !node.children.is_empty() {
                let n =
                    sum_children_preferred(tree, id, vertical, parent_main, parent_cross, measure);
                (clamp_size(n, min, max), 0, 0)
            } else {
                (clamp_size(0, min, max), 0, 0)
            }
        }
    }
}

fn sum_children_preferred(
    tree: &Tree,
    id: NodeId,
    vertical: bool,
    parent_main: u16,
    parent_cross: u16,
    measure: &dyn Measure,
) -> u16 {
    let node = &tree.nodes[id as usize];
    let mut sum = 0u16;
    for &cid in &node.children {
        let c = &tree.nodes[cid as usize];
        if !c.style.visible {
            continue;
        }
        let (main_len, min_m, max_m) = if vertical {
            (c.style.height, c.style.min_height, c.style.max_height)
        } else {
            (c.style.width, c.style.min_width, c.style.max_width)
        };
        let (pref, _, _) = resolve_child_main(
            tree,
            cid,
            main_len,
            parent_main,
            min_m,
            max_m,
            vertical,
            parent_cross,
            measure,
        );
        sum = sum.saturating_add(pref);
    }
    // padding of parent is outside this sum (applied on parent rect)
    let _ = Axis::Vertical;
    sum
}
