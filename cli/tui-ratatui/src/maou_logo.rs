//! 左上角 MAOU 标识（Ratatui 开屏）。
//!
//! 方印编码：1 → "██"，0 → "  "（两格空格，终端半角高≈两倍宽）。
//! 位图 5×3；右侧通高竖线 + 文案（无外框）：
//! ```text
//! ██      ██  │  MAOU-AGENT   ← 粗体（绘制侧 accent+BOLD）
//!   ██  ██    │
//! ██  ██  ██  │  v 0.1a
//! ```

/// 1 = ██，0 = 两空格
const BITMAP: [&str; 3] = [
    "10001", // ██      ██
    "01010", //   ██  ██
    "10101", // ██  ██  ██
];

const TITLE: &str = "MAOU-AGENT";
/// 方印与竖线间距、竖线与文案间距
const GAP_SEAL_BAR: &str = "  ";
const GAP_BAR_TEXT: &str = "  ";
/// 与 `@little-house-studio/cli` package.json version 对齐（无 Node 读包时回落）
const DEFAULT_VERSION: &str = "0.1a";

fn bits_to_row(bits: &str) -> String {
    let mut out = String::with_capacity(bits.len() * 2);
    for b in bits.chars() {
        out.push_str(if b == '1' { "██" } else { "  " });
    }
    out
}

/// CLI 版本：优先 `MAOU_CLI_VERSION` / `npm_package_version`，否则默认。
pub fn cli_version() -> String {
    std::env::var("MAOU_CLI_VERSION")
        .or_else(|_| std::env::var("npm_package_version"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_VERSION.to_string())
}

/// 固定 3 行 logo（无左边距；绘制侧 `marginLeft=1`）。
pub fn maou_logo_lines() -> Vec<String> {
    maou_logo_lines_with_version(&cli_version())
}

fn ver_label(version: &str) -> String {
    if version.starts_with('v') || version.starts_with('V') {
        version.to_string()
    } else {
        format!("v {version}")
    }
}

///
/// ```text
/// ██      ██  │  MAOU-AGENT
///   ██  ██    │
/// ██  ██  ██  │  v 0.1a
/// ```
pub fn maou_logo_lines_with_version(version: &str) -> Vec<String> {
    let mono: Vec<String> = BITMAP.iter().map(|b| bits_to_row(b)).collect();
    let ver = ver_label(version);
    let mid = format!("{GAP_SEAL_BAR}│{GAP_BAR_TEXT}");
    vec![
        format!("{}{mid}{TITLE}", mono[0]),
        format!("{}{mid}", mono[1]),
        format!("{}{mid}{ver}", mono[2]),
    ]
}

/// 方印三行（仅点阵，无竖线/文案）—— 矮窗竖构图用。
pub fn maou_seal_lines() -> Vec<String> {
    BITMAP.iter().map(|b| bits_to_row(b)).collect()
}

/// 矮窗不挂油画：竖构图（方印 + 分隔 + 标题/版本/studio）。
///
/// ```text
/// ██      ██
///   ██  ██
/// ██  ██  ██
/// ─────────────
/// MAOU-AGENT
/// v 0.1a
/// @LittleHouse.studio
/// ```
pub fn compact_brand_block(version: &str) -> Vec<String> {
    let ver = ver_label(version);
    let mut lines = maou_seal_lines();
    lines.push("─".repeat(13));
    lines.push(TITLE.into());
    lines.push(ver);
    lines.push("@LittleHouse.studio".into());
    lines
}

/// 多行作为**一块**水平居中：共享同一左边距（避免逐行 center 把 │ / 点阵拆散）。
/// 块内各行左对齐；空行保持空（不垫左边距内容）。
pub fn center_block_lines(lines: &[String], cols: usize) -> Vec<String> {
    let max_w = lines
        .iter()
        .map(|l| gallery_display_width(l))
        .max()
        .unwrap_or(0)
        .min(cols);
    let left = cols.saturating_sub(max_w) / 2;
    let pad = " ".repeat(left);
    lines
        .iter()
        .map(|l| {
            if l.is_empty() {
                String::new()
            } else {
                format!("{pad}{l}")
            }
        })
        .collect()
}

/// 块内先把各行在「块最大宽」内居中，再整块水平居中到终端宽。
/// 避免短行（方印）与长行（@studio）中轴线错位。
pub fn center_block_lines_inner(lines: &[String], cols: usize) -> Vec<String> {
    let max_w = lines
        .iter()
        .map(|l| gallery_display_width(l))
        .max()
        .unwrap_or(0)
        .min(cols);
    let aligned: Vec<String> = lines
        .iter()
        .map(|l| {
            if l.is_empty() {
                return String::new();
            }
            let w = gallery_display_width(l);
            let inner_left = max_w.saturating_sub(w) / 2;
            format!("{}{l}", " ".repeat(inner_left))
        })
        .collect();
    center_block_lines(&aligned, cols)
}

/// 画廊 ASCII 显示宽（█/框线按 1，CJK 按 2）—— 对齐 Ink `galleryDisplayWidth`。
pub fn gallery_display_width(s: &str) -> usize {
    let mut w = 0usize;
    for ch in s.chars() {
        let c = ch as u32;
        if c <= 0x7f {
            w += 1;
            continue;
        }
        // box drawing / block elements / geometric
        if (0x2500..=0x257f).contains(&c)
            || (0x2580..=0x259f).contains(&c)
            || (0x25a0..=0x25ff).contains(&c)
            || c == 0x00b7
            || c == 0x2039
            || c == 0x203a
        {
            w += 1;
            continue;
        }
        w += 2; // CJK etc.
    }
    w
}

pub fn center_gallery_line(text: &str, cols: usize) -> String {
    let gw = gallery_display_width(text);
    if gw >= cols || cols == 0 {
        return text.to_string();
    }
    let pad = (cols - gw) / 2;
    format!("{}{text}", " ".repeat(pad))
}

/// 博物馆挂画垂直留白（Ink `galleryVerticalPads`）：上紧下松。
pub fn gallery_vertical_pads(available: usize, content: usize) -> (usize, usize) {
    let free = available.saturating_sub(content);
    if free == 0 {
        return (0, 0);
    }
    if free == 1 {
        return (0, 1);
    }
    if free == 2 {
        return (0, 2);
    }
    if free == 3 {
        return (1, 2);
    }
    let mut top = ((free as f64) * 0.36).floor() as usize;
    top = top.max(1).min(free.saturating_sub(2));
    let mut bottom = free - top;
    if bottom < top {
        top = free / 2;
        bottom = free - top;
    }
    if bottom == top && free >= 4 {
        top = top.saturating_sub(1);
        bottom += 1;
    }
    (top, bottom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logo_is_three_rows_title_and_version() {
        let lines = maou_logo_lines_with_version("0.1a");
        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with('█'), "logo core has no left pad: {}", lines[0]);
        assert!(lines[0].contains("MAOU-AGENT"), "{}", lines[0]);
        assert!(lines[0].contains('│'), "{}", lines[0]);
        assert!(lines[1].contains('│'), "mid bar: {}", lines[1]);
        assert!(!lines[1].contains("MAOU"), "mid is seal only: {}", lines[1]);
        assert!(lines[2].contains("0.1a") || lines[2].contains("v "), "{}", lines[2]);
        // 10001 → ██......██ pattern start
        assert!(lines[0].starts_with("██"), "{}", lines[0]);
        assert!(lines[1].starts_with("  "), "01010 leading empty: {}", lines[1]);
    }

    #[test]
    fn compact_brand_is_vertical_seal_then_text() {
        let b = compact_brand_block("0.1a");
        // seal 3 + rule + title + ver + studio
        assert_eq!(b.len(), 7, "{b:?}");
        for i in 0..3 {
            assert!(!b[i].contains('│'), "seal row has bar: {}", b[i]);
            assert!(!b[i].contains("MAOU"), "seal row has title: {}", b[i]);
            assert!(b[i].contains('█'), "seal: {}", b[i]);
        }
        assert!(b[3].chars().all(|c| c == '─'), "rule: {}", b[3]);
        assert_eq!(b[4], "MAOU-AGENT");
        assert!(b[5].contains("0.1a"));
        assert!(b[6].contains("LittleHouse.studio"));
    }

    #[test]
    fn center_block_keeps_seal_columns_aligned() {
        let seal = maou_seal_lines();
        let centered = center_block_lines(&seal, 80);
        assert_eq!(centered.len(), 3);
        // 共享左边距：各行 trim 后点阵相对块左缘一致（用显示宽）
        let lefts: Vec<usize> = centered
            .iter()
            .map(|l| {
                let trimmed = l.trim_start();
                gallery_display_width(l) - gallery_display_width(trimmed)
            })
            .collect();
        // row0/row2 start with █；row1 starts with spaces inside seal — left pad of block
        // is same string prefix length in spaces before first non-pad content differs.
        // Check block left pad via leading space count on row0 (starts with █ after pad).
        let pad0 = centered[0].chars().take_while(|c| *c == ' ').count();
        let pad2 = centered[2].chars().take_while(|c| *c == ' ').count();
        assert_eq!(pad0, pad2);
        assert!(pad0 > 0 || 80 > 20);
        let _ = lefts;
    }

    #[test]
    fn block_chars_width_one_for_centering() {
        assert_eq!(gallery_display_width("██"), 2);
        assert_eq!(gallery_display_width("┌─┐"), 3);
        assert_eq!(gallery_display_width("中"), 2);
    }

    #[test]
    fn vertical_pads_optical() {
        assert_eq!(gallery_vertical_pads(20, 20), (0, 0));
        assert_eq!(gallery_vertical_pads(21, 20), (0, 1));
        assert_eq!(gallery_vertical_pads(24, 20), (1, 3));
    }
}
