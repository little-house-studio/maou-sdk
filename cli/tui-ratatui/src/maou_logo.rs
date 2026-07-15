//! 左上角 MAOU 标识 —— 与 Ink `gallery/maou-logo.ts` 固定样式对齐。
//!
//! 方印编码：1 → "██"，0 → "  "（两格空格，终端半角高≈两倍宽）。
//! 位图 7×5；右侧文案顶行 MAOU-AGENT，隔一行版本。

/// 1 = ██，0 = 两空格
const BITMAP: [&str; 5] = [
    "1111111",
    "1011101",
    "1101011",
    "1010101",
    "1111111",
];

const TITLE: &str = "MAOU-AGENT";
const GAP: &str = "  ";
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

/// 固定 5 行 logo（无左边距；调用方加 Ink `marginLeft={1}`）。
pub fn maou_logo_lines() -> Vec<String> {
    maou_logo_lines_with_version(&cli_version())
}

pub fn maou_logo_lines_with_version(version: &str) -> Vec<String> {
    let mono: Vec<String> = BITMAP.iter().map(|b| bits_to_row(b)).collect();
    let ver_label = if version.starts_with('v') || version.starts_with('V') {
        version.to_string()
    } else {
        format!("v {version}")
    };
    vec![
        format!("{}{GAP}{TITLE}", mono[0]),
        mono[1].clone(),
        format!("{}{GAP}{ver_label}", mono[2]),
        mono[3].clone(),
        mono[4].clone(),
    ]
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
    fn logo_is_five_rows_title_and_version() {
        let lines = maou_logo_lines_with_version("0.1a");
        assert_eq!(lines.len(), 5);
        assert!(lines[0].contains("MAOU-AGENT"), "{}", lines[0]);
        assert!(lines[0].contains('█'), "bitmap: {}", lines[0]);
        assert!(lines[2].contains("0.1a") || lines[2].contains("v "), "{}", lines[2]);
        // left-aligned bitmap starts with full blocks (no leading space in core logo)
        assert!(lines[0].starts_with('█'), "logo core has no left pad: {}", lines[0]);
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
