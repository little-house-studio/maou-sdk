/**
 * terminal.rs — 终端实例管理
 *
 * 封装 portable-pty，管理单个终端的生命周期：
 * - 创建 PTY + spawn 进程
 * - 读取输出流 → ring buffer + callback
 * - 写入（键盘输入模拟）
 * - 停止（SIGTERM → SIGKILL）
 * - 复用（退出后重新创建 PTY）
 * - 跨平台 shell 选择
 */

use crate::error::{TerminalError, TerminalResult};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem, native_pty_system};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// 终端状态
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum TerminalState {
    Running,
    Exited,
    Interrupted,
    Killed,
}

impl std::fmt::Display for TerminalState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Running => write!(f, "running"),
            Self::Exited => write!(f, "exited"),
            Self::Interrupted => write!(f, "interrupted"),
            Self::Killed => write!(f, "killed"),
        }
    }
}

/// ring buffer 最大行数
const RING_MAX_LINES: usize = 2000;

/// 终端输出事件
#[derive(Debug, Clone)]
pub struct OutputEvent {
    pub terminal_id: String,
    pub event_type: OutputEventType,
    pub data: String,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum OutputEventType {
    Data,
    Exit,
    Error,
    Timeout,
}

/// 终端实例
pub struct Terminal {
    pub id: String,
    pub agent_name: String,
    pub command: String,
    pub description: String,
    pub cwd: String,
    pub state: TerminalState,
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
    pub last_viewed_at: Option<String>,

    /// ring buffer（按行存储）
    ring: Arc<Mutex<Vec<String>>>,
    /// 行拼接缓冲（未满一行的数据）
    line_buf: Arc<Mutex<String>>,
    /// 输出字符总量（用于截断）
    total_chars: Arc<Mutex<usize>>,
    /// PTY master writer
    writer: Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>>,
    /// 子进程
    child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send>>>>,
    /// 是否正在运行
    running: Arc<AtomicBool>,
    /// 启动时间
    started_at: Option<Instant>,
}

/// 持久化结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedTerminal {
    pub id: String,
    pub agent_name: String,
    pub command: String,
    pub description: String,
    pub cwd: String,
    pub state: String,
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
    pub last_viewed_at: Option<String>,
    /// ring buffer 持久化（最近 N 行）
    pub ring: Vec<String>,
}

/// 创建终端的选项
#[derive(Debug, Clone)]
pub struct CreateOptions {
    pub id: String,
    pub agent_name: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub description: String,
}

/// 跨平台 shell 选择
fn get_platform_shell() -> (String, Vec<String>) {
    if cfg!(target_os = "windows") {
        // Windows: 优先 PowerShell，回退 cmd
        let ps = std::env::var("PSModulePath").unwrap_or_default();
        if !ps.is_empty() || std::path::Path::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe").exists() {
            ("powershell.exe".to_string(), vec!["-NoLogo".to_string(), "-NoExit".to_string()])
        } else {
            ("cmd.exe".to_string(), vec!["/K".to_string()])
        }
    } else {
        // Unix: 优先 $SHELL，回退 /bin/bash
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        (shell, vec!["-l".to_string()])
    }
}

/// 构建安全环境变量（白名单过滤）
fn build_safe_env() -> Vec<(String, String)> {
    const ENV_WHITELIST: &[&str] = &[
        "PATH", "HOME", "USER", "USERNAME", "USERPROFILE", "SHELL",
        "LANG", "LC_ALL", "LC_CTYPE",
        "TERM", "COLORTERM", "TMPDIR", "TMP", "TEMP",
        "APPDATA", "LOCALAPPDATA", "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT",
        "JAVA_HOME", "NODE_PATH", "PYTHONPATH", "GOPATH", "GOROOT",
        "RUSTUP_HOME", "CARGO_HOME", "NVM_DIR", "CONDA_PREFIX",
        "ProgramFiles", "ProgramFiles(x86)", "ProgramData",
    ];

    let mut env: Vec<(String, String)> = ENV_WHITELIST
        .iter()
        .filter_map(|&key| std::env::var(key).ok().map(|v| (key.to_string(), v)))
        .collect();
    // 强制设置 TERM
    env.push(("TERM".to_string(), "xterm-256color".to_string()));
    env
}

impl Terminal {
    /// 创建并启动终端
    pub fn spawn(opts: CreateOptions, command: &str) -> TerminalResult<Self> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::PtySpawnFailed(e.to_string()))?;

        // 跨平台 shell
        let (shell, shell_args) = get_platform_shell();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.args(&shell_args);

        // 安全环境变量
        for (k, v) in build_safe_env() {
            cmd.env(k, v);
        }

        // 工作目录
        cmd.cwd(&opts.cwd);

        // 命令注入（平台特定）
        if cfg!(target_os = "windows") {
            // Windows: PowerShell -Command "..."  或  cmd /c "..."
            if shell.contains("powershell") {
                cmd = CommandBuilder::new(&shell);
                cmd.args(&["-NoLogo", "-Command", command]);
            } else {
                cmd = CommandBuilder::new(&shell);
                cmd.args(&["/C", command]);
            }
            // 重新设置 env 和 cwd
            for (k, v) in build_safe_env() {
                cmd.env(k, v);
            }
            cmd.cwd(&opts.cwd);
        } else {
            // Unix: bash -c "command"
            cmd = CommandBuilder::new(&shell);
            cmd.arg("-c");
            cmd.arg(command);
            for (k, v) in build_safe_env() {
                cmd.env(k, v);
            }
            cmd.cwd(&opts.cwd);
        }

        // spawn
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TerminalError::PtySpawnFailed(e.to_string()))?;

        // 获取 reader
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| TerminalError::PtySpawnFailed(format!("clone reader: {}", e)))?;

        // 获取 writer
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| TerminalError::PtySpawnFailed(format!("take writer: {}", e)))?;

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let terminal = Self {
            id: opts.id,
            agent_name: opts.agent_name,
            command: command.to_string(),
            description: opts.description,
            cwd: opts.cwd,
            state: TerminalState::Running,
            exit_code: None,
            created_at: now.clone(),
            updated_at: now,
            last_viewed_at: None,
            ring: Arc::new(Mutex::new(Vec::with_capacity(RING_MAX_LINES))),
            line_buf: Arc::new(Mutex::new(String::new())),
            total_chars: Arc::new(Mutex::new(0)),
            writer: Arc::new(Mutex::new(Some(writer))),
            child: Arc::new(Mutex::new(Some(child))),
            running: Arc::new(AtomicBool::new(true)),
            started_at: Some(Instant::now()),
        };

        // 在独立线程读取输出
        let ring = terminal.ring.clone();
        let line_buf = terminal.line_buf.clone();
        let total_chars = terminal.total_chars.clone();
        let running = terminal.running.clone();
        let terminal_id = terminal.id.clone();

        std::thread::spawn(move || {
            let mut buf_reader = BufReader::new(reader);
            let mut line = String::new();

            loop {
                line.clear();
                match buf_reader.read_line(&mut line) {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        // 存入 ring buffer
                        let mut ring_guard = ring.lock().unwrap();
                        ring_guard.push(line.clone());
                        if ring_guard.len() > RING_MAX_LINES {
                            let drain_count = ring_guard.len() - RING_MAX_LINES;
                            ring_guard.drain(0..drain_count);
                        }
                        drop(ring_guard);

                        // 累计字符数
                        let mut tc = total_chars.lock().unwrap();
                        *tc += line.len();
                        drop(tc);
                    }
                    Err(_) => break,
                }
            }

            // reader 结束，标记为非 running
            running.store(false, Ordering::SeqCst);
        });

        Ok(terminal)
    }

    /// 写入（键盘输入模拟）
    pub fn write(&self, data: &str) -> TerminalResult<()> {
        if !self.running.load(Ordering::SeqCst) {
            return Err(TerminalError::NotRunning(self.id.clone()));
        }

        let mut writer_guard = self.writer.lock().unwrap();
        if let Some(ref mut writer) = *writer_guard {
            use std::io::Write;
            writer
                .write_all(data.as_bytes())
                .map_err(|e| TerminalError::PtyWriteFailed(e.to_string()))?;
            writer
                .flush()
                .map_err(|e| TerminalError::PtyWriteFailed(e.to_string()))?;
            Ok(())
        } else {
            Err(TerminalError::PtyWriteFailed("writer 已被释放".to_string()))
        }
    }

    /// 停止终端（SIGTERM → 等待 → SIGKILL）
    pub fn kill(&mut self) -> TerminalResult<()> {
        self.running.store(false, Ordering::SeqCst);

        let mut child_guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            child
                .kill()
                .map_err(|e| TerminalError::PtyKillFailed(e.to_string()))?;
        }

        self.state = TerminalState::Killed;
        self.updated_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        Ok(())
    }

    /// 等待子进程退出，返回 exit code
    pub fn wait_exit(&self) -> TerminalResult<Option<i32>> {
        let mut child_guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            let status = child
                .wait()
                .map_err(|e| TerminalError::PtyReadFailed(format!("wait exit: {}", e)))?;
            Ok(Some(status.exit_code() as i32))
        } else {
            Ok(None)
        }
    }

    /// 非阻塞检查是否已退出
    pub fn try_wait_exit(&self) -> TerminalResult<Option<i32>> {
        let mut child_guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            match child.try_wait() {
                Ok(Some(status)) => Ok(Some(status.exit_code() as i32)),
                Ok(None) => Ok(None),
                Err(e) => Err(TerminalError::PtyReadFailed(format!("try_wait: {}", e))),
            }
        } else {
            Ok(None)
        }
    }

    /// 获取 ring buffer 的最后 n 行
    pub fn tail(&self, n: usize) -> String {
        let ring_guard = self.ring.lock().unwrap();
        let start = if ring_guard.len() > n {
            ring_guard.len() - n
        } else {
            0
        };
        ring_guard[start..].join("")
    }

    /// 获取 ring buffer 的最后 n 字符
    pub fn tail_chars(&self, n: usize) -> String {
        let ring_guard = self.ring.lock().unwrap();
        let total: String = ring_guard.join("");
        if total.len() <= n {
            total
        } else {
            let start = total.len() - n;
            format!("...{}", &total[start..])
        }
    }

    /// 更新最后查看时间
    pub fn touch_viewed(&mut self) {
        self.last_viewed_at =
            Some(chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string());
    }

    /// 标记为已退出
    pub fn mark_exited(&mut self, exit_code: Option<i32>) {
        self.running.store(false, Ordering::SeqCst);
        self.state = TerminalState::Exited;
        self.exit_code = exit_code;
        self.updated_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    }

    /// 标记为已中断（重启恢复）
    pub fn mark_interrupted(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        self.state = TerminalState::Interrupted;
        self.updated_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    }

    /// 是否正在运行
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// 序列化为持久化结构
    pub fn to_persisted(&self) -> PersistedTerminal {
        let ring = self.ring.lock().unwrap().clone();
        PersistedTerminal {
            id: self.id.clone(),
            agent_name: self.agent_name.clone(),
            command: self.command.clone(),
            description: self.description.clone(),
            cwd: self.cwd.clone(),
            state: self.state.to_string(),
            exit_code: self.exit_code,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            last_viewed_at: self.last_viewed_at.clone(),
            ring,
        }
    }

    /// 从持久化结构恢复（不恢复 PTY，仅元数据 + ring buffer）
    pub fn from_persisted(p: PersistedTerminal) -> Self {
        let state = match p.state.as_str() {
            "running" => TerminalState::Interrupted, // running → interrupted
            "exited" => TerminalState::Exited,
            "interrupted" => TerminalState::Interrupted,
            "killed" => TerminalState::Killed,
            _ => TerminalState::Interrupted,
        };

        Self {
            id: p.id,
            agent_name: p.agent_name,
            command: p.command,
            description: p.description,
            cwd: p.cwd,
            state,
            exit_code: p.exit_code,
            created_at: p.created_at,
            updated_at: p.updated_at,
            last_viewed_at: p.last_viewed_at,
            ring: Arc::new(Mutex::new(p.ring)),
            line_buf: Arc::new(Mutex::new(String::new())),
            total_chars: Arc::new(Mutex::new(0)),
            writer: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            started_at: None,
        }
    }
}
