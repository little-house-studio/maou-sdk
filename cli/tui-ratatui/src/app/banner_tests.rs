//! 顶部横幅渲染：左 agent · 中 tip · 右 审批权限（整帧 TestBackend 断言）。

use super::App;
use crate::theme::color_hex;
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::sync::mpsc;
use unicode_width::UnicodeWidthStr;

fn app_with_banner(agent: &str, mode: &str, label: &str, tips: &[&str]) -> App {
    let (_tx, rx) = mpsc::channel();
    let mut app = App::new(rx);
    app.agent = agent.into();
    app.chrome.approval_mode = Some(mode.into());
    app.chrome.approval_label = Some(label.into());
    app.chrome.tips = tips.iter().map(|s| (*s).to_string()).collect();
    app
}

/// 第 0 行一格：屏幕列 + 字符 + 背景色 hex（宽字符续格已剔除）
struct BannerCell {
    x: u16,
    sym: String,
    bg: String,
}

/// 画一帧后取回顶行。TestBackend 把宽字符的续格填为空格，
/// 按 symbol 宽度跳格才能还原「命令面板」而非「命 令 面 板」。
fn draw_top_row(app: &mut App, w: u16, h: u16) -> Vec<BannerCell> {
    let mut term = Terminal::new(TestBackend::new(w, h)).expect("terminal");
    term.draw(|f| app.draw(f)).expect("draw");
    let buf = term.backend().buffer();
    let mut out: Vec<BannerCell> = Vec::new();
    let mut x = 0u16;
    while x < w {
        let cell = &buf[(x, 0)];
        let sym = cell.symbol().to_string();
        let step = UnicodeWidthStr::width(sym.as_str()).max(1) as u16;
        out.push(BannerCell {
            x,
            sym,
            bg: color_hex(cell.bg),
        });
        x = x.saturating_add(step);
    }
    out
}

fn row_text(cells: &[BannerCell]) -> String {
    cells.iter().map(|c| c.sym.as_str()).collect()
}

#[test]
fn banner_shows_agent_tip_and_approval() {
    let mut app = app_with_banner("coding", "normal", "询问", &["Ctrl+K 命令面板"]);
    let cells = draw_top_row(&mut app, 80, 24);
    let row = row_text(&cells);
    assert!(row.starts_with(" ◆ coding "), "agent 靠最左: {row:?}");
    assert!(row.contains("※ Ctrl+K 命令面板"), "tip 在中段: {row:?}");
    assert!(row.ends_with(" NORMAL · 询问 "), "审批靠最右: {row:?}");

    // tip 居中：左右留白列数差 ≤ 1（center() 奇数宽把多的 1 列给右侧）
    let left_w = UnicodeWidthStr::width(" ◆ coding ") as u16;
    let right_x = 80 - UnicodeWidthStr::width(" NORMAL · 询问 ") as u16;
    let ink: Vec<&BannerCell> = cells
        .iter()
        .filter(|c| c.x >= left_w && c.x < right_x && c.sym != " ")
        .collect();
    let first = ink.first().expect("tip cells").x;
    let last = ink.last().expect("tip cells");
    let last_end = last.x + UnicodeWidthStr::width(last.sym.as_str()).max(1) as u16;
    let lead = first - left_w;
    let trail = right_x - last_end;
    assert!(
        lead.abs_diff(trail) <= 1,
        "tip 未居中: lead={lead} trail={trail} row={row:?}"
    );
}

#[test]
fn banner_approval_chip_color_tracks_mode() {
    let th = crate::theme::Theme::default();
    for (mode, title, want_bg) in [
        ("normal", "NORMAL", color_hex(th.input_field_bg)),
        ("auto", "AUTO", color_hex(th.warn)),
        ("yolo", "YOLO", color_hex(th.err)),
    ] {
        let mut app = app_with_banner("coding", mode, "x", &[]);
        let cells = draw_top_row(&mut app, 60, 20);
        let row = row_text(&cells);
        assert!(row.contains(title), "{mode}: {row:?}");
        // 末格属于芯片 → 背景 = 该模式色；行首属于横幅底
        assert_eq!(cells.last().expect("cells").bg, want_bg, "{mode} 芯片底色");
        // 横幅底 = footer_bg（浅），与聊天底 bg 明确分层，不能混色
        assert_eq!(cells[0].bg, color_hex(th.footer_bg), "{mode} 横幅底色");
        assert_ne!(cells[0].bg, color_hex(th.bg), "{mode} 横幅不能与聊天同底");
    }
}

#[test]
fn banner_keeps_approval_when_narrow() {
    // 窄屏优先级：审批芯片 > agent 名 > tip
    let mut app = app_with_banner(
        "very-long-agent-name",
        "yolo",
        "全放",
        &["很长的提示文案在窄屏应被丢掉"],
    );
    let cells = draw_top_row(&mut app, 24, 12);
    let row = row_text(&cells);
    assert_eq!(UnicodeWidthStr::width(row.as_str()), 24, "整行铺满: {row:?}");
    assert!(row.contains("YOLO"), "窄屏仍保留审批: {row:?}");
    assert!(!row.contains('※'), "窄屏丢弃 tip: {row:?}");
}

#[test]
fn banner_absent_in_full_editor() {
    let mut app = app_with_banner("coding", "normal", "询问", &["Ctrl+K 命令面板"]);
    app.full_editor = true;
    let row = row_text(&draw_top_row(&mut app, 80, 24));
    assert!(!row.contains("coding"), "全屏编辑器无横幅: {row:?}");
    assert!(!row.contains("NORMAL"), "全屏编辑器无审批芯片: {row:?}");
}
