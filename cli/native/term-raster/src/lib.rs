//! maou-term-raster —— Ink 兼容的终端帧编码（N-API）
//!
//! 不替代 React/Ink 组件树；只加速 vram-layer 的 encode + 行 diff + ANSI 组装。
//! JS 仍负责 Yoga layout 与 lastGrid 采集。

#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// 扁平帧：row-major，长度 = rows * cols
#[napi(object)]
pub struct FlatFrame {
  pub cols: u32,
  pub rows: u32,
  /// 每格字符；continuation 用空串
  pub ch: Vec<String>,
  /// 每格 SGR 前缀（可为空）
  pub sgr: Vec<String>,
  /// 显示宽：1 正常，0 continuation，2+ 全角首格
  pub w: Vec<u32>,
}

#[napi(object)]
pub struct PaintResult {
  /// 本帧每行编码后的字符串（供 JS 缓存 prevEncodedLines）
  pub lines: Vec<String>,
  /// 可直接 write 的 ANSI（含光标定位）；无变化时为空
  pub out: String,
  pub dirty: u32,
  /// true = 走了 native 路径
  pub native: bool,
}

fn encode_row(
  ch: &[String],
  sgr: &[String],
  w: &[u32],
  row: usize,
  cols: usize,
  theme_bg: &str,
) -> String {
  let base = row * cols;
  let mut line = String::with_capacity(cols * 4);
  let mut last_sgr = if theme_bg.is_empty() {
    "\x1b[0m".to_string()
  } else {
    theme_bg.to_string()
  };
  let mut vis_w: u32 = 0;

  for c in 0..cols {
    let i = base + c;
    if i >= ch.len() {
      break;
    }
    let width = w.get(i).copied().unwrap_or(1);
    if width == 0 {
      continue;
    }
    if vis_w >= cols as u32 {
      break;
    }
    let cell_ch = ch.get(i).map(|s| s.as_str()).unwrap_or(" ");
    let glyph = if cell_ch.is_empty() { " " } else { cell_ch };
    let cell_sgr = sgr.get(i).map(|s| s.as_str()).unwrap_or("");

    // 与 JS encodeLine 对齐：无 bg 时叠 themeBg；统一保证以 reset 开头
    let has_bg = cell_sgr.contains("48;");
    let mut target = if !has_bg && !theme_bg.is_empty() {
      format!("{theme_bg}{cell_sgr}")
    } else if cell_sgr.is_empty() {
      "\x1b[0m".to_string()
    } else {
      cell_sgr.to_string()
    };
    if !target.starts_with("\x1b[0m") {
      target = format!("\x1b[0m{target}");
    }
    if target != last_sgr {
      line.push_str(&target);
      last_sgr = target;
    }
    line.push_str(glyph);
    vis_w = vis_w.saturating_add(width.max(1));
  }

  if last_sgr != "\x1b[0m" {
    line.push_str("\x1b[0m");
  }
  // 关闭 OSC 8 超链接，避免拖尾下划线
  line.push_str("\x1b]8;;\x1b\\");
  line
}

/// 编码整帧并做行 diff，返回 stdout 用 ANSI。
#[napi]
pub fn paint_diff(
  frame: FlatFrame,
  theme_bg_sgr: String,
  prev_lines: Option<Vec<String>>,
  force_all: bool,
) -> Result<PaintResult> {
  let cols = frame.cols as usize;
  let rows = frame.rows as usize;
  if cols == 0 || rows == 0 {
    return Ok(PaintResult {
      lines: vec![],
      out: String::new(),
      dirty: 0,
      native: true,
    });
  }
  let need = cols.saturating_mul(rows);
  if frame.ch.len() < need || frame.sgr.len() < need || frame.w.len() < need {
    return Err(Error::from_reason(format!(
      "flat frame length mismatch: need {need}, ch={}, sgr={}, w={}",
      frame.ch.len(),
      frame.sgr.len(),
      frame.w.len()
    )));
  }

  let mut lines: Vec<String> = Vec::with_capacity(rows);
  for r in 0..rows {
    lines.push(encode_row(
      &frame.ch,
      &frame.sgr,
      &frame.w,
      r,
      cols,
      &theme_bg_sgr,
    ));
  }

  let prev = prev_lines.unwrap_or_default();
  let same_size = !force_all && prev.len() == rows;
  let mut out = String::with_capacity(rows * (cols + 24));
  let mut dirty: u32 = 0;

  let bg = if theme_bg_sgr.is_empty() {
    ""
  } else {
    theme_bg_sgr.as_str()
  };

  if !same_size || force_all {
    out.push_str("\x1b[H\x1b[?25l");
    for (r, line) in lines.iter().enumerate() {
      // CSI row;1H + theme bg + erase line + content
      out.push_str(&format!("\x1b[{};1H{}\x1b[K{}", r + 1, bg, line));
      dirty += 1;
    }
  } else {
    out.push_str("\x1b[?25l");
    for (r, line) in lines.iter().enumerate() {
      if prev.get(r).map(|p| p == line).unwrap_or(false) {
        continue;
      }
      out.push_str(&format!("\x1b[{};1H{}\x1b[K{}", r + 1, bg, line));
      dirty += 1;
    }
  }

  if dirty > 0 {
    out.push_str("\x1b[0m\x1b[?25l");
  } else {
    out.clear();
  }

  Ok(PaintResult {
    lines,
    out,
    dirty,
    native: true,
  })
}

/// 探测 native 是否可用
#[napi]
pub fn raster_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}
