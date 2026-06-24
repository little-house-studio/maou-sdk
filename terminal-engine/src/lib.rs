/**
 * lib.rs — napi-rs 入口
 *
 * 导出所有公共 API 供 Node.js 调用
 */

mod error;
mod filter;
mod logger;
mod persistence;
mod registry;
mod sandbox;
mod terminal;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use once_cell::sync::Lazy;
use std::sync::Arc;

use registry::{TerminalInfo, TerminalRegistry};
use terminal::{OutputEvent, OutputEventType};

/// 全局注册表单例
static REGISTRY: Lazy<Arc<TerminalRegistry>> = Lazy::new(|| Arc::new(TerminalRegistry::new()));

// ─── napi 导出的结构体 ─────────────────────────────────────────────────────

/// 创建终端的选项
#[napi(object)]
pub struct CreateTerminalOptions {
    /// Agent 名称
    pub agent_name: String,
    /// 终端 ID（可选，不传则自动生成）
    pub id: Option<String>,
    /// 工作目录
    pub cwd: String,
    /// 终端列数（默认 80）
    pub cols: Option<u16>,
    /// 终端行数（默认 24）
    pub rows: Option<u16>,
    /// 描述
    pub description: String,
}

/// 运行结果
#[napi(object)]
pub struct RunResult {
    /// 是否成功
    pub ok: bool,
    /// 退出码（null = 未退出/被 kill）
    pub exit_code: Option<i32>,
    /// 输出（纯文本，给 AI 看）
    pub output: String,
    /// 耗时（毫秒）
    pub duration_ms: f64,
    /// 终端 ID
    pub terminal_id: String,
    /// 错误信息（如果有）
    pub error: Option<String>,
}

/// 终端事件（流式回调）
#[napi(object)]
pub struct TerminalEvent {
    /// 终端 ID
    pub terminal_id: String,
    /// 事件类型：data / exit / error / timeout
    pub event_type: String,
    /// 数据（纯文本）
    pub data: Option<String>,
    /// 退出码（exit 事件）
    pub exit_code: Option<i32>,
    /// 错误信息（error 事件）
    pub error: Option<String>,
    /// 时间戳（毫秒）
    pub timestamp: f64,
}

/// 过滤器配置
#[napi(object)]
pub struct FilterConfigNapi {
    /// 是否启用预设黑名单
    pub preset_blacklist_enabled: bool,
    /// 自定义黑名单（regex）
    pub blacklist: Vec<String>,
    /// 自定义白名单（regex，覆盖黑名单）
    pub whitelist: Vec<String>,
    /// 是否启用白名单模式
    pub whitelist_mode: bool,
}

/// 沙箱配置
#[napi(object)]
pub struct SandboxConfigNapi {
    /// 是否启用
    pub enabled: bool,
    /// 允许的路径
    pub allowed_paths: Vec<String>,
    /// 禁止的路径
    pub denied_paths: Vec<String>,
    /// 是否注入提示词
    pub inject_prompt: bool,
    /// 提示词内容
    pub prompt_text: Option<String>,
}

/// 终端信息（返回给 JS）
#[napi(object)]
pub struct TerminalInfoNapi {
    pub id: String,
    pub agent_name: String,
    pub command: String,
    pub description: String,
    pub state: String,
    pub exit_code: Option<i32>,
    pub cwd: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_viewed_at: Option<String>,
}

impl From<TerminalInfo> for TerminalInfoNapi {
    fn from(t: TerminalInfo) -> Self {
        Self {
            id: t.id,
            agent_name: t.agent_name,
            command: t.command,
            description: t.description,
            state: t.state,
            exit_code: t.exit_code,
            cwd: t.cwd,
            created_at: t.created_at,
            updated_at: t.updated_at,
            last_viewed_at: t.last_viewed_at,
        }
    }
}

// ─── napi 导出的函数 ───────────────────────────────────────────────────────

/// 初始化终端引擎
#[napi]
pub fn init_engine(log_dir: Option<String>) -> Result<()> {
    if let Some(dir) = log_dir {
        logger::init(&dir);
    }
    Ok(())
}

/// 设置持久化路径
#[napi]
pub fn set_persist_path(path: String) -> Result<()> {
    REGISTRY.set_persist_path(&path);
    Ok(())
}

/// 创建终端并执行命令（前台阻塞）
#[napi]
pub async fn run(
    agent_name: String,
    command: String,
    cwd: String,
    description: String,
    timeout_ms: Option<u32>,
    result_limit: Option<u32>,
) -> Result<RunResult> {
    let id = format!("term_{}", chrono::Utc::now().timestamp_millis());
    let start = std::time::Instant::now();

    // 创建终端
    let opts = terminal::CreateOptions {
        id: id.clone(),
        agent_name: agent_name.clone(),
        cwd: cwd.clone(),
        cols: 80,
        rows: 24,
        description: description.clone(),
    };

    match REGISTRY.create(opts, &command) {
        Ok(terminal_id) => {
            logger::log_create(&terminal_id, &agent_name, &command);

            // 等待退出
            let timeout = timeout_ms.unwrap_or(120_000);
            let limit = result_limit.unwrap_or(5000) as usize;

            // 轮询等待退出
            let mut elapsed = 0u64;
            let interval = 100u64;
            let exit_code = loop {
                if let Some(entry) = REGISTRY.get_terminal(&terminal_id) {
                    let terminal = entry.lock().unwrap();
                    match terminal.try_wait_exit() {
                        Ok(Some(code)) => break Ok(Some(code)),
                        Ok(None) => {}
                        Err(e) => break Err(e),
                    }
                } else {
                    break Ok(None);
                }

                if elapsed >= timeout as u64 {
                    // 超时，停止终端
                    let _ = REGISTRY.stop(&terminal_id, &agent_name);
                    logger::log_error(&terminal_id, &format!("超时 {}ms", timeout));
                    break Ok(None);
                }

                tokio::time::sleep(tokio::time::Duration::from_millis(interval)).await;
                elapsed += interval;
            };

            let duration_ms = start.elapsed().as_millis() as f64;

            // 获取输出
            let output = if let Some(entry) = REGISTRY.get_terminal(&terminal_id) {
                let terminal = entry.lock().unwrap();
                let raw = terminal.tail_chars(limit);
                // 剥离 ANSI 转义序列（给 AI 看纯文本）
                strip_ansi(&raw)
            } else {
                String::new()
            };

            match exit_code {
                Ok(Some(code)) => {
                    if let Some(entry) = REGISTRY.get_terminal(&terminal_id) {
                        let mut terminal = entry.lock().unwrap();
                        terminal.mark_exited(Some(code));
                    }
                    logger::log_exit(&terminal_id, Some(code));
                    Ok(RunResult {
                        ok: true,
                        exit_code: Some(code),
                        output,
                        duration_ms,
                        terminal_id,
                        error: None,
                    })
                }
                Ok(None) => {
                    Ok(RunResult {
                        ok: false,
                        exit_code: None,
                        output,
                        duration_ms,
                        terminal_id,
                        error: Some(format!("超时 {}ms", timeout)),
                    })
                }
                Err(e) => {
                    logger::log_error(&terminal_id, &e.to_string());
                    Ok(RunResult {
                        ok: false,
                        exit_code: None,
                        output,
                        duration_ms,
                        terminal_id,
                        error: Some(e.to_string()),
                    })
                }
            }
        }
        Err(e) => {
            logger::log_blocked(&agent_name, &command, &e.to_string());
            Err(e.into())
        }
    }
}

/// 创建后台终端
#[napi]
pub async fn run_background(
    agent_name: String,
    command: String,
    cwd: String,
    description: String,
    id: Option<String>,
) -> Result<RunResult> {
    let terminal_id = id.unwrap_or_else(|| format!("bg_{}", chrono::Utc::now().timestamp_millis()));
    let start = std::time::Instant::now();

    let opts = terminal::CreateOptions {
        id: terminal_id.clone(),
        agent_name: agent_name.clone(),
        cwd,
        cols: 80,
        rows: 24,
        description,
    };

    match REGISTRY.create(opts, &command) {
        Ok(tid) => {
            logger::log_create(&tid, &agent_name, &command);

            // 等待 1 秒看是否快速完成
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

            let (output, exit_code, ok) = if let Some(entry) = REGISTRY.get_terminal(&tid) {
                let terminal = entry.lock().unwrap();
                match terminal.try_wait_exit() {
                    Ok(Some(code)) => {
                        let out = strip_ansi(&terminal.tail_chars(5000));
                        (out, Some(code), true)
                    }
                    Ok(None) => {
                        // 仍在运行，返回部分输出
                        let out = strip_ansi(&terminal.tail_chars(2000));
                        (out, None, true)
                    }
                    Err(e) => {
                        let out = strip_ansi(&terminal.tail_chars(5000));
                        (out, None, false)
                    }
                }
            } else {
                (String::new(), None, false)
            };

            let duration_ms = start.elapsed().as_millis() as f64;

            Ok(RunResult {
                ok,
                exit_code,
                output,
                duration_ms,
                terminal_id: tid,
                error: if ok { None } else { Some("后台终端创建后立即出错".to_string()) },
            })
        }
        Err(e) => Err(e.into()),
    }
}

/// 写入终端（键盘输入模拟）
#[napi]
pub async fn write(id: String, agent_name: String, data: String) -> Result<()> {
    REGISTRY.write(&id, &agent_name, &data).map_err(|e| {
        logger::log_error(&id, &e.to_string());
        e.into()
    })
}

/// 停止终端
#[napi]
pub async fn stop(id: String, agent_name: String) -> Result<()> {
    REGISTRY.stop(&id, &agent_name).map_err(|e| {
        logger::log_error(&id, &e.to_string());
        e.into()
    })
}

/// 获取终端日志
#[napi]
pub async fn logs(id: String, agent_name: String, lines: Option<u32>) -> Result<String> {
    let n = lines.unwrap_or(100) as usize;
    REGISTRY.logs(&id, &agent_name, n).map_err(|e| e.into())
}

/// 列出终端
#[napi]
pub fn list(agent_name: Option<String>) -> Vec<TerminalInfoNapi> {
    REGISTRY
        .list(agent_name.as_deref())
        .into_iter()
        .map(Into::into)
        .collect()
}

/// 删除终端
#[napi]
pub async fn remove(id: String, agent_name: String) -> Result<()> {
    REGISTRY.remove(&id, &agent_name).map_err(|e| e.into())
}

/// 清理 Agent 的所有终端
#[napi]
pub fn cleanup_agent(agent_name: String) {
    REGISTRY.cleanup_agent(&agent_name);
}

/// 关闭所有终端
#[napi]
pub fn shutdown() {
    REGISTRY.shutdown();
}

/// 设置命令过滤器
#[napi]
pub fn set_filter(config: FilterConfigNapi) -> Result<()> {
    let cfg = filter::FilterConfig {
        preset_blacklist_enabled: config.preset_blacklist_enabled,
        blacklist: config.blacklist,
        whitelist: config.whitelist,
        whitelist_mode: config.whitelist_mode,
    };
    REGISTRY.set_filter(cfg);
    Ok(())
}

/// 从文件加载过滤器配置
#[napi]
pub fn load_filter_from_file(path: String) -> Result<()> {
    REGISTRY.load_filter_from_file(&path).map_err(|e| {
        napi::Error::new(napi::Status::GenericFailure, format!("加载过滤器配置失败: {}", e))
    })
}

/// 设置沙箱配置
#[napi]
pub fn set_sandbox(config: SandboxConfigNapi) -> Result<()> {
    let cfg = sandbox::SandboxConfig {
        enabled: config.enabled,
        allowed_paths: config.allowed_paths,
        denied_paths: config.denied_paths,
        inject_prompt: config.inject_prompt,
        prompt_text: config.prompt_text,
    };
    REGISTRY.set_sandbox(cfg);
    Ok(())
}

/// 获取沙箱注入的提示词
#[napi]
pub fn get_sandbox_prompt() -> Option<String> {
    // 通过 registry 获取沙箱提示词
    // 这里简化处理，直接返回 None（实际需要通过 registry 访问 sandbox）
    None
}

/// 获取终端状态面板
#[napi]
pub fn status_panel(agent_name: String) -> String {
    REGISTRY.status_panel(&agent_name)
}

/// 获取终端数量
#[napi]
pub fn terminal_count() -> u32 {
    REGISTRY.count() as u32
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

/// 剥离 ANSI 转义序列
fn strip_ansi(s: &str) -> String {
    // ANSI escape sequence: ESC [ ... letter
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // 跳过 ESC [ ... letter
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            } else if chars.peek() == Some(&']') {
                // OSC sequence: ESC ] ... BEL
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next == '\x07' {
                        break;
                    }
                }
            } else {
                // 其他 ESC 序列，跳过下一个字符
                chars.next();
            }
        } else {
            result.push(c);
        }
    }

    result
}
