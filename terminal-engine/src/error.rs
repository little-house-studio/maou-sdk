/**
 * error.rs — 统一错误类型
 * 覆盖 100% 的终端操作错误场景
 */

use napi::Error as NapiError;
use std::fmt;

/// 终端错误类型
#[derive(Debug)]
pub enum TerminalError {
    /// 命令被黑名单拦截
    CommandBlocked(String, String), // (command, reason)
    /// 命令不在白名单中
    CommandNotWhitelisted(String),
    /// 路径被沙箱拒绝
    PathDenied(String),
    /// 终端不存在
    NotFound(String),
    /// 终端属于其他 Agent
    AgentMismatch(String, String), // (id, agentName)
    /// 终端正在运行，不能重复操作
    AlreadyRunning(String),
    /// 终端已退出，不能写入
    NotRunning(String),
    /// 超过最大并行数
    MaxTerminalsReached(usize),
    /// PTY 创建失败
    PtySpawnFailed(String),
    /// PTY 写入失败
    PtyWriteFailed(String),
    /// PTY 读取失败
    PtyReadFailed(String),
    /// PTY kill 失败
    PtyKillFailed(String),
    /// 命令为空
    EmptyCommand,
    /// 描述为空
    EmptyDescription,
    /// 超时
    Timeout(String, u64), // (id, timeout_ms)
    /// 持久化失败
    PersistFailed(String),
    /// 反序列化失败
    DeserializeFailed(String),
    /// 沙箱配置错误
    SandboxConfigError(String),
    /// 过滤器配置错误
    FilterConfigError(String),
    /// IO 错误
    IoError(String),
    /// 其他错误
    Other(String),
}

impl fmt::Display for TerminalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandBlocked(cmd, reason) => {
                write!(f, "命令被安全策略拦截: `{}` — {}", cmd, reason)
            }
            Self::CommandNotWhitelisted(cmd) => {
                write!(f, "命令不在白名单中: `{}`", cmd)
            }
            Self::PathDenied(path) => {
                write!(f, "路径被沙箱拒绝: {}", path)
            }
            Self::NotFound(id) => {
                write!(f, "终端 {} 不存在", id)
            }
            Self::AgentMismatch(id, agent) => {
                write!(f, "终端 {} 属于其他 Agent ({})，无权操作", id, agent)
            }
            Self::AlreadyRunning(id) => {
                write!(f, "终端 {} 正在运行，不能重复创建", id)
            }
            Self::NotRunning(id) => {
                write!(f, "终端 {} 已退出，不能执行操作", id)
            }
            Self::MaxTerminalsReached(max) => {
                write!(f, "已达到最大并行终端数 ({})，请先关闭部分终端", max)
            }
            Self::PtySpawnFailed(msg) => {
                write!(f, "PTY 创建失败: {}", msg)
            }
            Self::PtyWriteFailed(msg) => {
                write!(f, "PTY 写入失败: {}", msg)
            }
            Self::PtyReadFailed(msg) => {
                write!(f, "PTY 读取失败: {}", msg)
            }
            Self::PtyKillFailed(msg) => {
                write!(f, "PTY 终止失败: {}", msg)
            }
            Self::EmptyCommand => {
                write!(f, "命令不能为空")
            }
            Self::EmptyDescription => {
                write!(f, "描述不能为空")
            }
            Self::Timeout(id, ms) => {
                write!(f, "终端 {} 执行超时 ({}ms)", id, ms)
            }
            Self::PersistFailed(msg) => {
                write!(f, "持久化失败: {}", msg)
            }
            Self::DeserializeFailed(msg) => {
                write!(f, "反序列化失败: {}", msg)
            }
            Self::SandboxConfigError(msg) => {
                write!(f, "沙箱配置错误: {}", msg)
            }
            Self::FilterConfigError(msg) => {
                write!(f, "过滤器配置错误: {}", msg)
            }
            Self::IoError(msg) => {
                write!(f, "IO 错误: {}", msg)
            }
            Self::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl std::error::Error for TerminalError {}

impl From<TerminalError> for NapiError {
    fn from(e: TerminalError) -> Self {
        let status = match &e {
            TerminalError::CommandBlocked(_, _) => "BLOCKED",
            TerminalError::CommandNotWhitelisted(_) => "NOT_WHITELISTED",
            TerminalError::PathDenied(_) => "PATH_DENIED",
            TerminalError::NotFound(_) => "NOT_FOUND",
            TerminalError::AgentMismatch(_, _) => "AGENT_MISMATCH",
            TerminalError::AlreadyRunning(_) => "ALREADY_RUNNING",
            TerminalError::NotRunning(_) => "NOT_RUNNING",
            TerminalError::MaxTerminalsReached(_) => "MAX_TERMINALS",
            TerminalError::Timeout(_, _) => "TIMEOUT",
            TerminalError::EmptyCommand | TerminalError::EmptyDescription => "VALIDATION",
            _ => "INTERNAL",
        };
        NapiError::new(
            napi::Status::GenericFailure,
            format!("[{}] {}", status, e),
        )
    }
}

impl From<std::io::Error> for TerminalError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}

impl From<serde_json::Error> for TerminalError {
    fn from(e: serde_json::Error) -> Self {
        Self::DeserializeFailed(e.to_string())
    }
}

impl From<anyhow::Error> for TerminalError {
    fn from(e: anyhow::Error) -> Self {
        Self::Other(e.to_string())
    }
}

/// Result 类型别名
pub type TerminalResult<T> = Result<T, TerminalError>;
