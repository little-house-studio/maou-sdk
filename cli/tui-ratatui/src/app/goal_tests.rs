//! Goal UI：常态 1 行 chip，点开才是详情浮层（对齐 grok 的 status-chip + detail-modal）。

use super::App;
use crate::protocol::{ProtoChrome, ProtoSupervisor};
use ratatui::backend::TestBackend;
use ratatui::Terminal;
use std::sync::mpsc;
use unicode_width::UnicodeWidthStr;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn app_with_goal(state: &str, plan: Option<&str>) -> App {
    app_with_goal_started(state, plan, Some(now_ms().saturating_sub(83_000)))
}

fn app_with_goal_started(
    state: &str,
    plan: Option<&str>,
    started_at_ms: Option<u64>,
) -> App {
    let (_tx, rx) = mpsc::channel();
    let mut app = App::new(rx);
    app.chrome = ProtoChrome {
        supervisor: Some(ProtoSupervisor {
            active: true,
            state: state.into(),
            plan: plan.map(|p| p.to_string()),
            verify_rounds: Some(2),
            last_verdict: Some("pass".into()),
            objective: Some("把缓存命中率修对".into()),
            started_at_ms,
            tokens_used: Some(12_500),
            token_budget: Some(200_000),
        }),
        ..Default::default()
    };
    app
}

/// 画一帧，返回逐行文本（宽字符续格已按宽度跳过）
fn frame_rows(app: &mut App, w: u16, h: u16) -> Vec<String> {
    let mut term = Terminal::new(TestBackend::new(w, h)).expect("terminal");
    term.draw(|f| app.draw(f)).expect("draw");
    let buf = term.backend().buffer();
    (0..h)
        .map(|y| {
            let mut s = String::new();
            let mut x = 0u16;
            while x < w {
                let sym = buf[(x, y)].symbol().to_string();
                let step = UnicodeWidthStr::width(sym.as_str()).max(1) as u16;
                s.push_str(&sym);
                x = x.saturating_add(step);
            }
            s
        })
        .collect()
}

fn find_row(rows: &[String], needle: &str) -> Option<usize> {
    rows.iter().position(|r| r.contains(needle))
}

#[test]
fn goal_collapsed_is_exactly_one_row() {
    let mut app = app_with_goal("started", Some("# 目标\n步骤一\n步骤二"));
    let rows = frame_rows(&mut app, 100, 30);
    let chip = find_row(&rows, "Goal:").expect("chip 行");
    // chip 只占 1 行：相邻行不得再出现 goal 内容
    assert!(
        !rows[chip + 1].contains("Goal:"),
        "chip 应只占 1 行: {:?}",
        &rows[chip..chip + 2]
    );
    let r = &rows[chip];
    assert!(r.contains("执行中"), "相位: {r:?}");
    assert!(r.contains("验收 2 轮"), "验收轮数: {r:?}");
    assert!(r.contains("12.5k tokens"), "token: {r:?}");
    assert!(r.contains("▸ 详情"), "展开提示: {r:?}");
    // 计划正文不该出现在收起态
    assert!(find_row(&rows, "步骤一").is_none(), "收起态不铺计划");
}

#[test]
fn goal_chip_marks_states_needing_user() {
    for (state, label) in [
        ("planning", "规划中"),
        ("confirming_plan", "待确认计划"),
        ("confirming", "待验收"),
    ] {
        let mut app = app_with_goal(state, None);
        let rows = frame_rows(&mut app, 100, 30);
        let chip = find_row(&rows, "Goal:").expect("chip");
        assert!(rows[chip].contains(label), "{state} → {label}: {:?}", rows[chip]);
    }
}

#[test]
fn goal_detail_opens_on_toggle_and_shows_sections() {
    let mut app = app_with_goal("confirming_plan", Some("# 修复缓存\n第一步\n第二步"));
    app.toggle_goal_detail();
    let rows = frame_rows(&mut app, 100, 30);

    assert!(find_row(&rows, "把缓存命中率修对").is_some(), "标题=objective");
    assert!(find_row(&rows, "状态").is_some(), "状态段");
    assert!(find_row(&rows, "用量").is_some(), "用量段");
    assert!(find_row(&rows, "计划").is_some(), "计划段");
    assert!(find_row(&rows, "第一步").is_some(), "计划正文");
    assert!(find_row(&rows, "确认计划").is_some(), "该状态给确认按钮");
    assert!(find_row(&rows, "退出监督").is_some(), "总有退出");
    assert!(find_row(&rows, "[✗]").is_some(), "右上关闭按钮");
    // chip 仍在，且提示已变成收起
    let chip = find_row(&rows, "Goal:").expect("chip");
    assert!(rows[chip].contains("▾ 收起"), "chip 提示翻转: {:?}", rows[chip]);
}

#[test]
fn goal_detail_buttons_match_phase() {
    let mut app = app_with_goal("confirming", None);
    app.toggle_goal_detail();
    let rows = frame_rows(&mut app, 100, 30);
    assert!(find_row(&rows, "通过并结束监督").is_some(), "待验收 → 通过按钮");
    assert!(find_row(&rows, "确认计划").is_none(), "待验收不该有确认计划");

    let mut app2 = app_with_goal("started", None);
    app2.toggle_goal_detail();
    let rows2 = frame_rows(&mut app2, 100, 30);
    assert!(find_row(&rows2, "确认计划").is_none(), "执行中无确认按钮");
    assert!(find_row(&rows2, "通过并结束").is_none(), "执行中无通过按钮");
    assert!(find_row(&rows2, "退出监督").is_some(), "执行中仍可退出");
}

#[test]
fn goal_detail_button_hits_land_on_painted_rows() {
    let mut app = app_with_goal("confirming_plan", Some("plan line"));
    app.toggle_goal_detail();
    let rows = frame_rows(&mut app, 100, 30);
    assert!(!app.goal_action_hits.is_empty(), "应登记按钮热区");
    for (y, act) in app.goal_action_hits.clone() {
        let row = rows
            .get(y as usize)
            .unwrap_or_else(|| panic!("hit y={y} 超出屏幕"));
        let expect = match act.as_str() {
            "confirm_plan" => "确认计划",
            "confirm_pass" => "通过并结束",
            "exit" => "退出监督",
            other => panic!("未预期 action {other}"),
        };
        // 热区行必须真的画着那个按钮，否则点了没反应/点错
        assert!(row.contains(expect), "action={act} y={y} 行内容={row:?}");
    }
}

#[test]
fn goal_detail_closes_on_esc_and_when_goal_ends() {
    let mut app = app_with_goal("started", None);
    app.toggle_goal_detail();
    assert!(app.show_goal_detail);
    assert!(app.close_goal_detail(), "Esc 应消费掉这次按键");
    assert!(!app.show_goal_detail);
    assert!(!app.close_goal_detail(), "已关闭时不再消费 Esc");

    // goal 消失 → 详情不能孤零零留着
    app.toggle_goal_detail();
    assert!(app.show_goal_detail);
    app.chrome.supervisor = None;
    let rows = frame_rows(&mut app, 100, 30);
    assert!(find_row(&rows, "[✗]").is_none(), "goal 结束后浮层must消失");
    assert!(!app.show_goal_detail);
}

#[test]
fn goal_elapsed_freezes_while_waiting_on_user() {
    // 等用户的相位不该继续累计"执行耗时"
    let mut app = app_with_goal("confirming_plan", None);
    let a = app.goal_elapsed_ms().expect("elapsed");
    std::thread::sleep(std::time::Duration::from_millis(30));
    let b = app.goal_elapsed_ms().expect("elapsed");
    assert_eq!(a, b, "等用户时冻结: {a} → {b}");

    // 运行中相位随时间前进
    let mut run = app_with_goal("started", None);
    let c = run.goal_elapsed_ms().expect("elapsed");
    std::thread::sleep(std::time::Duration::from_millis(30));
    let d = run.goal_elapsed_ms().expect("elapsed");
    assert!(d > c, "运行中走字: {c} → {d}");
}

#[test]
fn goal_elapsed_never_goes_backwards() {
    let mut app = app_with_goal("started", None);
    let first = app.goal_elapsed_ms().expect("elapsed");
    assert!(first >= 83_000, "起点 83s 前: {first}");
    // Node 把起点往后挪（基线抖动）：读数不许倒退
    if let Some(s) = app.chrome.supervisor.as_mut() {
        s.started_at_ms = Some(now_ms());
    }
    // 同一个 goal（起点变了会被当新 goal 重置，这里显式保留 floor 语义）
    app.goal_started_at = app.chrome.supervisor.as_ref().and_then(|s| s.started_at_ms);
    app.goal_elapsed_floor_ms = first;
    let second = app.goal_elapsed_ms().expect("elapsed");
    assert!(second >= first, "不许倒退: {first} → {second}");
}

#[test]
fn goal_elapsed_rejects_insane_baseline() {
    // 1970 年的起点 / 未来时刻都是坏数据 → 显示 `—`，不摆出跨年时长
    for bad in [Some(1u64), Some(now_ms() + 600_000)] {
        let mut app = app_with_goal_started("started", None, bad);
        assert_eq!(app.goal_elapsed_ms(), None, "坏起点 {bad:?} 应判无效");
    }
    // 缺起点同样是「未知」
    let mut none = app_with_goal_started("started", None, None);
    assert_eq!(none.goal_elapsed_ms(), None);
}

#[test]
fn goal_chip_shows_dash_when_elapsed_unknown() {
    let mut app = app_with_goal_started("started", None, Some(1));
    let rows = frame_rows(&mut app, 100, 30);
    let chip = find_row(&rows, "Goal:").expect("chip");
    // 不可信起点：chip 上不许出现荒谬时长
    assert!(!rows[chip].contains("h"), "chip 不该出现小时级读数: {:?}", rows[chip]);
}

#[test]
fn goal_absent_paints_no_chip() {
    let (_tx, rx) = mpsc::channel();
    let mut app = App::new(rx);
    let rows = frame_rows(&mut app, 100, 30);
    assert!(find_row(&rows, "Goal:").is_none(), "无 goal 时不占行");
}
