/**
 * logger.rs — 结构化日志
 *
 * 使用 tracing crate，输出 JSON 格式日志
 * 可追溯：每条日志包含 terminal_id, agent_name, command 等
 */

use tracing::{info, warn, error, instrument};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// 初始化日志
pub fn init(log_dir: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    // 控制台日志
    let console_layer = fmt::layer()
        .with_target(false)
        .with_filter(filter.clone());

    // 文件日志（JSON 格式）
    let file_path = format!("{}/terminal-engine.log", log_dir);
    let _ = std::fs::create_dir_all(log_dir);

    let file_layer = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
    {
        Ok(file) => Some(
            fmt::layer()
                .json()
                .with_writer(file)
                .with_filter(filter),
        ),
        Err(_) => None,
    };

    tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .init();
}

/// 日志辅助函数
pub fn log_create(terminal_id: &str, agent_name: &str, command: &str) {
    info!(
        terminal_id = terminal_id,
        agent_name = agent_name,
        command = command,
        action = "create",
        "终端创建"
    );
}

pub fn log_exit(terminal_id: &str, exit_code: Option<i32>) {
    info!(
        terminal_id = terminal_id,
        exit_code = exit_code,
        action = "exit",
        "终端退出"
    );
}

pub fn log_stop(terminal_id: &str, agent_name: &str) {
    warn!(
        terminal_id = terminal_id,
        agent_name = agent_name,
        action = "stop",
        "终端停止"
    );
}

pub fn log_error(terminal_id: &str, error: &str) {
    error!(
        terminal_id = terminal_id,
        error = error,
        action = "error",
        "终端错误"
    );
}

pub fn log_blocked(agent_name: &str, command: &str, reason: &str) {
    warn!(
        agent_name = agent_name,
        command = command,
        reason = reason,
        action = "blocked",
        "命令被拦截"
    );
}
