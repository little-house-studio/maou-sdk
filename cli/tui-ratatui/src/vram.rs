//! Screen cell buffer (Ink "VRAM" equivalent).
//!
//! Captured each frame from ratatui's Buffer after draw.
//! Used by **global** selection: start outside chat → copy painted cells.

use ratatui::buffer::Buffer;
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Debug, Default)]
pub struct VramCell {
    pub ch: String,
    /// display width 0 for trailing half of wide char
    pub w: u8,
}

#[derive(Clone, Debug, Default)]
pub struct Vram {
    pub cols: u16,
    pub rows: u16,
    /// row-major, index = y * cols + x
    pub cells: Vec<VramCell>,
}

impl Vram {
    pub fn empty() -> Self {
        Self::default()
    }

    /// Snapshot ratatui frame buffer → VRAM (same role as Ink lastGrid).
    pub fn capture_from_buffer(&mut self, buf: &Buffer) {
        let area = buf.area();
        self.cols = area.width;
        self.rows = area.height;
        let n = (self.cols as usize) * (self.rows as usize);
        self.cells.clear();
        self.cells.resize(n, VramCell::default());

        for y in 0..self.rows {
            let mut x = 0u16;
            while x < self.cols {
                let Some(cell) = buf.cell((x, y)) else {
                    x += 1;
                    continue;
                };
                let sym = cell.symbol();
                let w = UnicodeWidthStr::width(sym).max(1) as u8;
                let idx = (y as usize) * (self.cols as usize) + (x as usize);
                if idx < self.cells.len() {
                    self.cells[idx] = VramCell {
                        ch: if sym.is_empty() {
                            " ".into()
                        } else {
                            sym.to_string()
                        },
                        w,
                    };
                    // mark continuation cells empty width 0 (wide glyphs)
                    for dx in 1..w {
                        let x2 = x + dx as u16;
                        if x2 >= self.cols {
                            break;
                        }
                        let i2 = (y as usize) * (self.cols as usize) + (x2 as usize);
                        if i2 < self.cells.len() {
                            self.cells[i2] = VramCell {
                                ch: String::new(),
                                w: 0,
                            };
                        }
                    }
                }
                x = x.saturating_add(w as u16).max(x + 1);
            }
        }
    }

    pub fn cell(&self, x: u16, y: u16) -> Option<&VramCell> {
        if x >= self.cols || y >= self.rows {
            return None;
        }
        self.cells
            .get((y as usize) * (self.cols as usize) + (x as usize))
    }

    /// Extract stream selection like Ink global mode (inclusive screen coords).
    pub fn extract_region(&self, r1: u16, c1: u16, r2: u16, c2: u16) -> String {
        if self.cols == 0 || self.rows == 0 {
            return String::new();
        }
        let (mut y1, mut x1, mut y2, mut x2) = (r1, c1, r2, c2);
        if y1 > y2 || (y1 == y2 && x1 > x2) {
            std::mem::swap(&mut y1, &mut y2);
            std::mem::swap(&mut x1, &mut x2);
        }
        y1 = y1.min(self.rows.saturating_sub(1));
        y2 = y2.min(self.rows.saturating_sub(1));
        x1 = x1.min(self.cols.saturating_sub(1));
        x2 = x2.min(self.cols.saturating_sub(1));

        // snap to start of wide cell
        let snap = |y: u16, mut x: u16| -> u16 {
            while x > 0 {
                if let Some(c) = self.cell(x, y) {
                    if c.w == 0 {
                        x -= 1;
                        continue;
                    }
                }
                break;
            }
            x
        };
        x1 = snap(y1, x1);
        x2 = snap(y2, x2);

        let mut lines: Vec<String> = Vec::new();
        for y in y1..=y2 {
            let (cs, ce) = if y1 == y2 {
                (x1, x2)
            } else if y == y1 {
                (x1, self.cols.saturating_sub(1))
            } else if y == y2 {
                (0, x2)
            } else {
                (0, self.cols.saturating_sub(1))
            };
            let mut s = String::new();
            let mut x = cs;
            while x <= ce {
                if let Some(cell) = self.cell(x, y) {
                    if cell.w == 0 {
                        x += 1;
                        continue;
                    }
                    s.push_str(&cell.ch);
                    x = x.saturating_add(cell.w as u16).max(x + 1);
                } else {
                    break;
                }
            }
            lines.push(s.trim_end().to_string());
        }
        while lines.first().map(|l| l.is_empty()).unwrap_or(false) {
            lines.remove(0);
        }
        while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
            lines.pop();
        }
        lines.join("\n")
    }

    /// Full screen dump (for Ctrl+G).
    pub fn dump_all(&self) -> String {
        if self.rows == 0 {
            return String::new();
        }
        self.extract_region(0, 0, self.rows.saturating_sub(1), self.cols.saturating_sub(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_region_reads_cell_grid() {
        let mut v = Vram {
            cols: 4,
            rows: 1,
            cells: vec![
                VramCell {
                    ch: "x".into(),
                    w: 1,
                },
                VramCell {
                    ch: "y".into(),
                    w: 1,
                },
                VramCell {
                    ch: "z".into(),
                    w: 1,
                },
                VramCell {
                    ch: " ".into(),
                    w: 1,
                },
            ],
        };
        let s = v.extract_region(0, 0, 0, 2);
        assert_eq!(s, "xyz");
        let _ = &mut v;
    }
}
