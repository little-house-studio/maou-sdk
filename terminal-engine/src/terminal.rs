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
use portable_pty::{
    CommandBuilder, MasterPty, NativePtySystem, PtyPair, PtySize, PtySystem, SlavePty,
    native_pty_system,
};
use serde::{Deserialize, Serialize};
use std::io::{Read, BufReader};
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
    /// 必须保活：Windows ConPTY 在 MasterPty drop 时 ClosePseudoConsole，
    /// 子进程会立刻以 0xC0000135 退出。
    #[allow(dead_code)]
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    /// slave 端同样保活（与 master 共享 ConPTY 内部状态）
    #[allow(dead_code)]
    slave: Option<Box<dyn portable_pty::SlavePty + Send>>,
    /// 子进程
    child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>,
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

/// Windows 下解析 SystemRoot（缺省 C:\Windows）
#[cfg(windows)]
fn windows_system_root() -> String {
    std::env::var("SystemRoot")
        .or_else(|_| std::env::var("SYSTEMROOT"))
        .or_else(|_| std::env::var("windir"))
        .unwrap_or_else(|_| r"C:\Windows".to_string())
}

/// 跨平台 shell 选择（Windows 使用绝对路径，避免 PATH 被污染时找不到 shell / DLL）
fn get_platform_shell() -> (String, Vec<String>) {
    if cfg!(target_os = "windows") {
        #[cfg(windows)]
        {
            let root = windows_system_root();
            // ConPTY 下 cmd 比 powershell 更稳；powershell 作为备选
            let cmd = format!(r"{}\System32\cmd.exe", root);
            if std::path::Path::new(&cmd).exists() {
                return (cmd, vec!["/D".to_string(), "/S".to_string()]);
            }
            let ps = format!(
                r"{}\System32\WindowsPowerShell\v1.0\powershell.exe",
                root
            );
            return (ps, vec!["-NoLogo".to_string(), "-NoProfile".to_string()]);
        }
        #[cfg(not(windows))]
        {
            ("cmd.exe".to_string(), vec!["/D".to_string()])
        }
    } else {
        // Unix: 优先 $SHELL，回退 /bin/bash
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        (shell, vec!["-l".to_string()])
    }
}

/// 规范化 Windows PATH：去掉伪路径 / MSYS 路径，并确保 System32 在前。
/// 污染的 PATH（如 Git Bash 混入、Agent 注入垃圾段）会导致 ConPTY 子进程
/// STATUS_DLL_NOT_FOUND (0xC0000135 / -1073741502)。
#[cfg(windows)]
fn sanitize_windows_path(raw: &str) -> String {
    let root = windows_system_root();
    let system32 = format!(r"{}\System32", root);
    let mut segs: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let push = |segs: &mut Vec<String>, seen: &mut std::collections::HashSet<String>, s: String| {
        let key = s.to_ascii_lowercase();
        if s.is_empty() || seen.contains(&key) {
            return;
        }
        seen.insert(key);
        segs.push(s);
    };

    // 关键系统目录优先
    push(&mut segs, &mut seen, system32.clone());
    push(&mut segs, &mut seen, root.clone());
    push(
        &mut segs,
        &mut seen,
        format!(r"{}\System32\Wbem", root),
    );
    push(
        &mut segs,
        &mut seen,
        format!(r"{}\System32\WindowsPowerShell\v1.0", root),
    );

    for seg in raw.split(';') {
        let s = seg.trim();
        if s.is_empty() {
            continue;
        }
        // 丢弃明显无效段（含换行、Agent 注入、Unix/MSYS 风格）
        if s.contains('\n') || s.contains('\r') {
            continue;
        }
        if s.starts_with("/c/")
            || s.starts_with("/C/")
            || s.starts_with(r"\c\")
            || s.starts_with(r"\C\")
            || s.starts_with("/usr/")
            || s.starts_with("/mingw")
        {
            continue;
        }
        // 必须以盘符路径或 UNC 开头才保留
        let bytes = s.as_bytes();
        let is_drive = bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/');
        let is_unc = s.starts_with(r"\\");
        if !(is_drive || is_unc) {
            continue;
        }
        push(&mut segs, &mut seen, s.replace('/', r"\"));
    }

    segs.join(";")
}

/// 构建子进程环境。
/// Windows：在 portable-pty 默认基境上只覆写关键项（PATH 净化、SystemRoot/ComSpec、TERM）。
/// 不要重建整个 env block——漏变量会导致 ConPTY 子进程 STATUS_DLL_NOT_FOUND。
/// Unix：白名单过滤（与历史行为一致）。
fn build_safe_env() -> Vec<(String, String)> {
    #[cfg(windows)]
    {
        let root = windows_system_root();
        let system32 = format!(r"{}\System32", root);
        let raw_path = std::env::var("Path")
            .or_else(|_| std::env::var("PATH"))
            .unwrap_or_default();
        let clean_path = sanitize_windows_path(&raw_path);
        vec![
            ("Path".to_string(), clean_path),
            (
                "PATHEXT".to_string(),
                std::env::var("PATHEXT").unwrap_or_else(|_| {
                    ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC".to_string()
                }),
            ),
            ("SystemRoot".to_string(), root.clone()),
            ("windir".to_string(), root.clone()),
            ("ComSpec".to_string(), format!(r"{}\cmd.exe", system32)),
            (
                "SystemDrive".to_string(),
                root.get(..2).unwrap_or("C:").to_string(),
            ),
            ("TERM".to_string(), "xterm-256color".to_string()),
        ]
    }

    #[cfg(not(windows))]
    {
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
        env.push(("TERM".to_string(), "xterm-256color".to_string()));
        env
    }
}

/// 规范化 cwd：空/相对路径落到当前目录；Windows 统一反斜杠。
fn normalize_cwd(cwd: &str) -> String {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| {
                if cfg!(windows) {
                    r"C:\".to_string()
                } else {
                    "/".to_string()
                }
            });
    }
    #[cfg(windows)]
    {
        let p = trimmed.replace('/', r"\");
        if std::path::Path::new(&p).is_dir() {
            p
        } else {
            // 非法 cwd 时回退，避免 CreateProcess ERROR_DIRECTORY(267)
            std::env::current_dir()
                .map(|d| d.to_string_lossy().into_owned())
                .unwrap_or(p)
        }
    }
    #[cfg(not(windows))]
    {
        trimmed.to_string()
    }
}

impl Terminal {
    /// 创建并启动终端
    pub fn spawn(opts: CreateOptions, command: &str) -> TerminalResult<Self> {
        let cwd = normalize_cwd(&opts.cwd);

        // Windows 一次性命令：默认走 std::process 捕获 stdout/stderr。
        // ConPTY 在本机/Agent 环境下读输出不稳定（CSI 6n、无输出 exit 1），
        // 而 use_terminal 的主路径是 run 一条命令拿结果——不必强上 PTY。
        // 设 MAOU_PTY_FORCE=1 可强制 ConPTY（交互调试用）。
        #[cfg(windows)]
        {
            let force_pty = std::env::var("MAOU_PTY_FORCE").ok().as_deref() == Some("1");
            if !force_pty {
                return Self::spawn_windows_oneshot(opts, command, cwd);
            }
        }

        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::PtySpawnFailed(e.to_string()))?;

        // 跨平台 shell（Windows 绝对路径）
        let (shell, _shell_args) = get_platform_shell();
        let envs = build_safe_env();

        // 命令注入（平台特定）—— 一次构建，避免重复 new 丢 env
        let mut cmd = CommandBuilder::new(&shell);
        if cfg!(target_os = "windows") {
            // Windows ConPTY 路径（MAOU_PTY_FORCE=1）
            if shell.to_ascii_lowercase().contains("powershell") {
                cmd.args(&[
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    command,
                ]);
            } else {
                cmd.args(&["/D", "/C", command]);
            }

            // 净化含换行的 env（破坏 CREATE_UNICODE_ENVIRONMENT 块）
            let raw = std::env::var("MAOU_PTY_RAW_ENV").ok().as_deref() == Some("1");
            if !raw {
                for (k, v) in std::env::vars() {
                    if v.contains('\n') || v.contains('\r') || v.contains('\0') || k.contains('\0') {
                        if k.eq_ignore_ascii_case("Path") || k.eq_ignore_ascii_case("PATH") {
                            cmd.env("Path", sanitize_windows_path(&v));
                        } else {
                            cmd.env_remove(&k);
                        }
                    }
                }
                let raw_path = std::env::var("Path")
                    .or_else(|_| std::env::var("PATH"))
                    .unwrap_or_default();
                cmd.env("Path", sanitize_windows_path(&raw_path));
                if let Ok(root) =
                    std::env::var("SystemRoot").or_else(|_| std::env::var("SYSTEMROOT"))
                {
                    cmd.env("SystemRoot", root);
                }
                if let Ok(cs) = std::env::var("ComSpec").or_else(|_| std::env::var("COMSPEC")) {
                    cmd.env("ComSpec", cs);
                }
                cmd.env("TERM", "xterm-256color");
            }
        } else {
            // Unix: bash -c "command"
            cmd.arg("-c");
            cmd.arg(command);
            for (k, v) in &envs {
                cmd.env(k, v);
            }
        }
        cmd.cwd(&cwd);

        // spawn（Windows ConPTY 走 SlavePty::spawn_command → CreateProcessW + ConPTY attr）
        let child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                return Err(TerminalError::PtySpawnFailed(format!(
                    "spawn `{}` in `{}`: {}",
                    shell, cwd, e
                )));
            }
        };

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
        let writer: Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>> =
            Arc::new(Mutex::new(Some(writer)));

        // 拆开 pair：master 必须活过整个 Terminal 生命周期（ClosePseudoConsole）
        let PtyPair { master, slave } = pair;
        drop(slave);

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let terminal = Self {
            id: opts.id,
            agent_name: opts.agent_name,
            command: command.to_string(),
            description: opts.description,
            cwd,
            state: TerminalState::Running,
            exit_code: None,
            created_at: now.clone(),
            updated_at: now,
            last_viewed_at: None,
            ring: Arc::new(Mutex::new(Vec::with_capacity(RING_MAX_LINES))),
            line_buf: Arc::new(Mutex::new(String::new())),
            total_chars: Arc::new(Mutex::new(0)),
            writer: writer.clone(),
            master: Some(master),
            slave: None,
            child: Arc::new(Mutex::new(Some(child))),
            running: Arc::new(AtomicBool::new(true)),
            started_at: Some(Instant::now()),
        };

        // 在独立线程读取输出（按字节块；自动应答 CSI 6n）
        let ring = terminal.ring.clone();
        let total_chars = terminal.total_chars.clone();
        let running = terminal.running.clone();
        let writer_for_dsr = writer;

        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            let mut pending = Vec::<u8>::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        // 应答 CSI 6 n（光标位置查询），避免 ConPTY host 卡住
                        let mut i = 0;
                        while i + 3 < pending.len() {
                            if pending[i] == 0x1b
                                && pending[i + 1] == b'['
                                && pending[i + 2] == b'6'
                                && pending[i + 3] == b'n'
                            {
                                if let Ok(mut g) = writer_for_dsr.lock() {
                                    if let Some(ref mut w) = *g {
                                        use std::io::Write;
                                        let _ = w.write_all(b"\x1b[1;1R");
                                        let _ = w.flush();
                                    }
                                }
                                pending.drain(i..i + 4);
                                continue;
                            }
                            i += 1;
                        }
                        if !pending.is_empty() {
                            let chunk = String::from_utf8_lossy(&pending).into_owned();
                            pending.clear();
                            let mut ring_guard = ring.lock().unwrap();
                            ring_guard.push(chunk.clone());
                            if ring_guard.len() > RING_MAX_LINES {
                                let drain_count = ring_guard.len() - RING_MAX_LINES;
                                ring_guard.drain(0..drain_count);
                            }
                            drop(ring_guard);
                            let mut tc = total_chars.lock().unwrap();
                            *tc += chunk.len();
                        }
                    }
                    Err(_) => break,
                }
            }
            running.store(false, Ordering::SeqCst);
        });

        Ok(terminal)
    }

    /// Windows 一次性命令：std::process 捕获输出，绕过 ConPTY 读输出问题。
    /// 命令结束后 ring buffer 已有完整输出，try_wait_exit 立即返回。
    #[cfg(windows)]
    fn spawn_windows_oneshot(
        opts: CreateOptions,
        command: &str,
        cwd: String,
    ) -> TerminalResult<Self> {
        use std::process::{Command, Stdio};

        let (shell, _) = get_platform_shell();
        let raw_path = std::env::var("Path")
            .or_else(|_| std::env::var("PATH"))
            .unwrap_or_default();
        let clean_path = sanitize_windows_path(&raw_path);

        let mut cmd = Command::new(&shell);
        if shell.to_ascii_lowercase().contains("powershell") {
            cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]);
        } else {
            cmd.args(["/D", "/C", command]);
        }
        cmd.current_dir(&cwd);
        cmd.env("Path", &clean_path);
        cmd.env("PATH", &clean_path);
        if let Ok(root) = std::env::var("SystemRoot").or_else(|_| std::env::var("SYSTEMROOT")) {
            cmd.env("SystemRoot", root);
        }
        if let Ok(cs) = std::env::var("ComSpec").or_else(|_| std::env::var("COMSPEC")) {
            cmd.env("ComSpec", cs);
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let output = cmd.output().map_err(|e| {
            TerminalError::PtySpawnFailed(format!("spawn `{}` /C `{}`: {}", shell, command, e))
        })?;

        let mut text = String::new();
        text.push_str(&String::from_utf8_lossy(&output.stdout));
        if !output.stderr.is_empty() {
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(&String::from_utf8_lossy(&output.stderr));
        }
        // 统一换行
        text = text.replace("\r\n", "\n").replace('\r', "\n");

        let code = output.status.code().unwrap_or(1);
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        // 把输出按行放进 ring，便于 tail_chars / logs
        let mut ring_lines: Vec<String> = Vec::new();
        if text.is_empty() {
            // 保持空
        } else if text.contains('\n') {
            for line in text.split_inclusive('\n') {
                ring_lines.push(line.to_string());
            }
        } else {
            ring_lines.push(text.clone());
        }

        Ok(Self {
            id: opts.id,
            agent_name: opts.agent_name,
            command: command.to_string(),
            description: opts.description,
            cwd,
            state: TerminalState::Exited,
            exit_code: Some(code),
            created_at: now.clone(),
            updated_at: now,
            last_viewed_at: None,
            ring: Arc::new(Mutex::new(ring_lines)),
            line_buf: Arc::new(Mutex::new(String::new())),
            total_chars: Arc::new(Mutex::new(text.len())),
            writer: Arc::new(Mutex::new(None)),
            master: None,
            slave: None,
            child: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            started_at: Some(Instant::now()),
        })
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
        // oneshot（Windows std::process）路径：spawn 时已结束
        if !self.running.load(Ordering::SeqCst) {
            if let Some(code) = self.exit_code {
                return Ok(Some(code));
            }
        }
        let mut child_guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            match child.try_wait() {
                Ok(Some(status)) => Ok(Some(status.exit_code() as i32)),
                Ok(None) => Ok(None),
                Err(e) => Err(TerminalError::PtyReadFailed(format!("try_wait: {}", e))),
            }
        } else if let Some(code) = self.exit_code {
            Ok(Some(code))
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
            master: None,
            slave: None,
            child: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            started_at: None,
        }
    }
}
