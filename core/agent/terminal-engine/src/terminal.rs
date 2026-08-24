/**
 * terminal.rs — 终端实例管理
 *
 * 默认：真 PTY（Unix openpty / Windows ConPTY）。`MAOU_PTY=0` 强制管道（调试/对比）。
 * AI 会话仍压制 pager；人壳（spawn_interactive）不压制、不剥 ANSI。
 *
 * - spawn 命令（PTY 默认 / 管道可选）
 * - 读取输出流 → ring buffer + subscribe 推 raw
 * - 写入 / resize（仅 PTY）
 * - 停止（kill 子进程；Unix 尽量挂进程组）
 */

use crate::error::{TerminalError, TerminalResult};
use crate::process_group::{self, ProcessGroup};
use crate::shell;
use portable_pty::{CommandBuilder, PtyPair, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Child as StdChild, Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// 流式订阅事件（给 JS subscribe；data 为 raw，含 ANSI）
#[derive(Clone)]
pub enum StreamEvent {
    Data(String),
    Exit(Option<i32>),
}

pub type StreamListener = Arc<dyn Fn(StreamEvent) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalKind {
    Agent,
    Human,
}

impl TerminalKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Human => "human",
        }
    }

    pub fn from_id_or_kind(id: &str, kind: Option<&str>) -> Self {
        if kind == Some("human") || id.starts_with("human_") {
            Self::Human
        } else {
            Self::Agent
        }
    }
}

enum PtyRole {
    AgentCommand,
    HumanShell,
}

/// 子进程句柄：管道或 PTY
enum ChildHandle {
    Std(StdChild),
    Pty(Box<dyn portable_pty::Child + Send + Sync>),
}

impl ChildHandle {
    fn try_wait(&mut self) -> std::io::Result<Option<i32>> {
        match self {
            Self::Std(c) => Ok(c.try_wait()?.map(|s| s.code().unwrap_or(1))),
            Self::Pty(c) => Ok(c.try_wait()?.map(|s| s.exit_code() as i32)),
        }
    }

    fn kill(&mut self) -> std::io::Result<()> {
        match self {
            Self::Std(c) => c.kill(),
            Self::Pty(c) => c
                .kill()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string())),
        }
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    fn process_id(&self) -> Option<u32> {
        match self {
            Self::Std(c) => Some(c.id()),
            Self::Pty(c) => c.process_id(),
        }
    }
}

/// 默认真 PTY。`MAOU_PTY=0`（或 false/no/off）强制管道。
fn pty_enabled() -> bool {
    matches!(
        std::env::var("MAOU_PTY").ok().as_deref(),
        Some("0") | Some("false") | Some("FALSE") | Some("no") | Some("off")
    )
    .then_some(false)
    .unwrap_or(true)
}

fn emit_listeners(listeners: &Mutex<Vec<(u32, StreamListener)>>, ev: StreamEvent) {
    if let Ok(ls) = listeners.lock() {
        for (_, cb) in ls.iter() {
            cb(ev.clone());
        }
    }
}

/// 把输出块写入 ring（按行切分，截断到 RING_MAX_LINES）
fn append_output_chunk(
    ring: &Mutex<Vec<String>>,
    line_buf: &Mutex<String>,
    total_chars: &Mutex<usize>,
    data: &str,
) {
    if data.is_empty() {
        return;
    }
    {
        let mut tc = total_chars.lock().unwrap();
        *tc += data.len();
    }
    let mut lb = line_buf.lock().unwrap();
    lb.push_str(data);
    let mut ring_guard = ring.lock().unwrap();
    while let Some(pos) = lb.find('\n') {
        let mut line = lb.drain(..=pos).collect::<String>();
        // 统一换行风格
        if line.ends_with("\r\n") {
            line.pop();
            line.pop();
            line.push('\n');
        } else if line.ends_with('\r') {
            line.pop();
            line.push('\n');
        }
        ring_guard.push(line);
    }
    // 无换行的长缓冲也落一份，避免长时间无输出可见
    if lb.len() > 4096 {
        let chunk = std::mem::take(&mut *lb);
        ring_guard.push(chunk);
    }
    if ring_guard.len() > RING_MAX_LINES {
        let drain = ring_guard.len() - RING_MAX_LINES;
        ring_guard.drain(0..drain);
    }
}

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
    /// PTY master writer（仅 PTY 模式；管道模式为 None）
    writer: Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>>,
    /// 必须保活：Windows ConPTY 在 MasterPty drop 时 ClosePseudoConsole，
    /// 子进程会立刻以 0xC0000135 退出。
    #[allow(dead_code)]
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    /// slave 端同样保活（与 master 共享 ConPTY 内部状态）
    #[allow(dead_code)]
    slave: Option<Box<dyn portable_pty::SlavePty + Send>>,
    /// 子进程（管道 StdChild 或 PTY Child）
    child: Arc<Mutex<Option<ChildHandle>>>,
    /// 进程树 teardown（Unix killpg / Windows Job Object）
    process_group: Option<ProcessGroup>,
    /// 是否正在运行
    running: Arc<AtomicBool>,
    /// 当前是否为真 PTY 会话（write / resize 仅在此模式下可用）
    is_pty: bool,
    kind: TerminalKind,
    listeners: Arc<Mutex<Vec<(u32, StreamListener)>>>,
    next_sub: Arc<AtomicU32>,
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
    #[serde(default)]
    pub kind: Option<String>,
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
    pub shell: Option<String>,
}

impl Terminal {
    /// 创建并启动 AI 命令终端。默认 PTY；`MAOU_PTY=0` 时管道。
    pub fn spawn(opts: CreateOptions, command: &str) -> TerminalResult<Self> {
        let cwd = shell::normalize_cwd(&opts.cwd);
        if pty_enabled() {
            Self::spawn_pty(opts, command, cwd, PtyRole::AgentCommand)
        } else {
            Self::spawn_pipe(opts, command, cwd)
        }
    }

    /// 人壳：裸 shell，始终真 PTY，不走 -c / /c，不压制 pager。
    pub fn spawn_interactive(opts: CreateOptions) -> TerminalResult<Self> {
        let cwd = shell::normalize_cwd(&opts.cwd);
        Self::spawn_pty(opts, "", cwd, PtyRole::HumanShell)
    }

    pub fn kind(&self) -> TerminalKind {
        self.kind
    }

    /// 全平台管道模式：shell -c / cmd /c，stdout+stderr 管道异步读入 ring。
    /// 支持后台长任务；前台超时转后台，不杀进程。不提供键盘 write（需 PTY）。
    fn spawn_pipe(opts: CreateOptions, command: &str, cwd: String) -> TerminalResult<Self> {
        let mut cmd = Self::build_pipe_command(command, &cwd)?;

        let mut child = cmd.spawn().map_err(|e| {
            TerminalError::PtySpawnFailed(format!("pipe spawn in `{}`: {}", cwd, e))
        })?;

        // 跨平台进程树：Unix 组 / Windows Job Object
        let mut pg = ProcessGroup::new().ok();
        if let Some(ref mut g) = pg {
            let _ = g.attach_std(&child);
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| TerminalError::PtySpawnFailed("stdout pipe missing".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| TerminalError::PtySpawnFailed("stderr pipe missing".into()))?;

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let ring = Arc::new(Mutex::new(Vec::with_capacity(RING_MAX_LINES)));
        let line_buf = Arc::new(Mutex::new(String::new()));
        let total_chars = Arc::new(Mutex::new(0usize));
        let running = Arc::new(AtomicBool::new(true));

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
            ring: ring.clone(),
            line_buf: line_buf.clone(),
            total_chars: total_chars.clone(),
            writer: Arc::new(Mutex::new(None)),
            master: None,
            slave: None,
            child: Arc::new(Mutex::new(Some(ChildHandle::Std(child)))),
            process_group: pg,
            running: running.clone(),
            is_pty: false,
            kind: TerminalKind::Agent,
            listeners: Arc::new(Mutex::new(Vec::new())),
            next_sub: Arc::new(AtomicU32::new(1)),
        };

        // 分别读 stdout / stderr，合并进同一 ring，并推 subscribe
        let listeners = terminal.listeners.clone();
        let spawn_reader = |mut reader: Box<dyn Read + Send>,
                            ring: Arc<Mutex<Vec<String>>>,
                            line_buf: Arc<Mutex<String>>,
                            total_chars: Arc<Mutex<usize>>,
                            listeners: Arc<Mutex<Vec<(u32, StreamListener)>>>| {
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let chunk = String::from_utf8_lossy(&buf[..n]);
                            append_output_chunk(&ring, &line_buf, &total_chars, &chunk);
                            emit_listeners(&listeners, StreamEvent::Data(chunk.into_owned()));
                        }
                        Err(_) => break,
                    }
                }
            })
        };

        spawn_reader(
            Box::new(stdout),
            ring.clone(),
            line_buf.clone(),
            total_chars.clone(),
            listeners.clone(),
        );
        spawn_reader(Box::new(stderr), ring, line_buf, total_chars, listeners);

        Ok(terminal)
    }

    /// 构造跨平台管道 Command（shell + env 统一走 shell 模块）
    fn build_pipe_command(command: &str, cwd: &str) -> TerminalResult<StdCommand> {
        let inv = shell::shell_command_argv(command);
        let mut cmd = StdCommand::new(&inv.program);
        shell::apply_invocation_to_std(&mut cmd, &inv);
        shell::apply_env_list(&mut cmd, &shell::capture_env());
        cmd.current_dir(cwd);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Unix: 新进程组 → ProcessGroup::killpg
        process_group::configure_new_process_group(&mut cmd);

        // Windows: 无控制台窗口 + 新进程组（Job Object 在 attach 时登记）
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
            cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
        }

        Ok(cmd)
    }

    /// 真 PTY：Unix openpty / Windows ConPTY。人壳始终走这里。
    fn spawn_pty(
        opts: CreateOptions,
        command: &str,
        cwd: String,
        role: PtyRole,
    ) -> TerminalResult<Self> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::PtySpawnFailed(e.to_string()))?;

        let inv = match role {
            PtyRole::HumanShell => shell::interactive_shell_argv(opts.shell.as_deref()),
            PtyRole::AgentCommand => shell::shell_command_argv(command),
        };
        let mut cmd = CommandBuilder::new(&inv.program);
        for a in &inv.args {
            cmd.arg(a);
        }
        // portable-pty CommandBuilder 无 raw_arg：Windows 把 /c 载荷作为普通 arg
        if let Some(ref raw) = inv.windows_cmd_raw_c {
            let inner = raw
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .unwrap_or(raw.as_str());
            cmd.arg(inner);
        }
        let env = match role {
            PtyRole::HumanShell => shell::human_shell_env(),
            PtyRole::AgentCommand => shell::interactive_env(),
        };
        for (k, v) in env {
            cmd.env(k, v);
        }
        for (k, v) in &inv.extra_env {
            cmd.env(k, v);
        }
        cmd.cwd(&cwd);

        let child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                return Err(TerminalError::PtySpawnFailed(format!(
                    "spawn `{}` in `{}`: {}",
                    inv.program, cwd, e
                )));
            }
        };

        let child_pid = child.process_id();
        let mut pg = None;
        #[cfg(unix)]
        {
            if let Some(pid) = child_pid {
                unsafe {
                    libc::setpgid(pid as i32, 0);
                }
                if let Ok(mut g) = ProcessGroup::new() {
                    let _ = g.attach_pid(pid);
                    pg = Some(g);
                }
            }
        }
        #[cfg(windows)]
        {
            // ConPTY 子进程挂 Job；Assign 失败（已在别的 Job 里）则 kill 时 taskkill /T
            if let Some(pid) = child_pid {
                if let Ok(mut g) = ProcessGroup::new() {
                    if g.attach_pid(pid).is_ok() {
                        pg = Some(g);
                    }
                }
            }
        }

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| TerminalError::PtySpawnFailed(format!("clone reader: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| TerminalError::PtySpawnFailed(format!("take writer: {}", e)))?;
        let writer: Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>> =
            Arc::new(Mutex::new(Some(writer)));

        let PtyPair { master, slave } = pair;
        drop(slave);

        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let display_cmd = match role {
            PtyRole::HumanShell => inv.program.clone(),
            PtyRole::AgentCommand => command.to_string(),
        };
        let kind = match role {
            PtyRole::HumanShell => TerminalKind::Human,
            PtyRole::AgentCommand => TerminalKind::Agent,
        };

        let terminal = Self {
            id: opts.id,
            agent_name: opts.agent_name,
            command: display_cmd,
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
            child: Arc::new(Mutex::new(Some(ChildHandle::Pty(child)))),
            process_group: pg,
            running: Arc::new(AtomicBool::new(true)),
            is_pty: true,
            kind,
            listeners: Arc::new(Mutex::new(Vec::new())),
            next_sub: Arc::new(AtomicU32::new(1)),
        };

        let ring = terminal.ring.clone();
        let line_buf = terminal.line_buf.clone();
        let total_chars = terminal.total_chars.clone();
        let running = terminal.running.clone();
        let listeners = terminal.listeners.clone();
        let writer_for_dsr = writer;

        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            let mut pending = Vec::<u8>::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        // 应答 CSI 6 n，避免 ConPTY host 卡住
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
                            append_output_chunk(&ring, &line_buf, &total_chars, &chunk);
                            emit_listeners(&listeners, StreamEvent::Data(chunk));
                        }
                    }
                    Err(_) => break,
                }
            }
            running.store(false, Ordering::SeqCst);
        });

        Ok(terminal)
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> TerminalResult<()> {
        if !self.is_pty {
            return Err(TerminalError::Other(
                "当前为管道模式，不支持 resize（MAOU_PTY=0）".into(),
            ));
        }
        let master = self.master.as_mut().ok_or_else(|| {
            TerminalError::Other("PTY master 不可用，无法 resize".into())
        })?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::Other(format!("resize 失败: {e}")))
    }

    pub fn subscribe(&self, cb: StreamListener) -> u32 {
        let id = self.next_sub.fetch_add(1, Ordering::SeqCst);
        self.listeners.lock().unwrap().push((id, cb));
        id
    }

    pub fn unsubscribe(&self, sub_id: u32) {
        self.listeners.lock().unwrap().retain(|(id, _)| *id != sub_id);
    }

    /// 写入（键盘输入模拟）—— 仅真 PTY 模式
    pub fn write(&self, data: &str) -> TerminalResult<()> {
        if !self.is_pty {
            return Err(TerminalError::PtyWriteFailed(
                "当前为管道模式，不支持 write 键盘输入。需要交互时请去掉 MAOU_PTY=0 后重启"
                    .into(),
            ));
        }
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

    /// 停止终端：先 ProcessGroup（整树），再 kill 直接 child；Windows 再 taskkill /T
    pub fn kill(&mut self) -> TerminalResult<()> {
        self.running.store(false, Ordering::SeqCst);

        if let Some(ref pg) = self.process_group {
            let _ = pg.terminate();
            // 短延迟后强制
            std::thread::sleep(std::time::Duration::from_millis(50));
            let _ = pg.kill();
        }

        let mut child_guard = self.child.lock().unwrap();
        #[cfg(windows)]
        let pid = child_guard.as_ref().and_then(ChildHandle::process_id);
        if let Some(ref mut child) = *child_guard {
            let _ = child.kill();
        }
        drop(child_guard);

        #[cfg(windows)]
        if let Some(pid) = pid {
            process_group::taskkill_tree(pid);
        }

        self.state = TerminalState::Killed;
        self.updated_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        emit_listeners(&self.listeners, StreamEvent::Exit(self.exit_code));
        Ok(())
    }

    /// 非阻塞检查是否已退出
    pub fn try_wait_exit(&self) -> TerminalResult<Option<i32>> {
        if let Some(code) = self.exit_code {
            if !self.running.load(Ordering::SeqCst) {
                return Ok(Some(code));
            }
        }
        let mut child_guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            match child.try_wait() {
                Ok(Some(code)) => {
                    // 冲刷行缓冲残余
                    drop(child_guard);
                    self.flush_line_buf();
                    Ok(Some(code))
                }
                Ok(None) => Ok(None),
                Err(e) => Err(TerminalError::PtyReadFailed(format!("try_wait: {}", e))),
            }
        } else if let Some(code) = self.exit_code {
            Ok(Some(code))
        } else {
            Ok(None)
        }
    }

    fn flush_line_buf(&self) {
        let mut lb = self.line_buf.lock().unwrap();
        if lb.is_empty() {
            return;
        }
        let rest = std::mem::take(&mut *lb);
        drop(lb);
        let mut ring = self.ring.lock().unwrap();
        ring.push(rest);
        if ring.len() > RING_MAX_LINES {
            let drain = ring.len() - RING_MAX_LINES;
            ring.drain(0..drain);
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
        emit_listeners(&self.listeners, StreamEvent::Exit(exit_code));
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
            kind: Some(self.kind.as_str().to_string()),
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
        let kind = TerminalKind::from_id_or_kind(&p.id, p.kind.as_deref());

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
            process_group: None,
            running: Arc::new(AtomicBool::new(false)),
            is_pty: false,
            kind,
            listeners: Arc::new(Mutex::new(Vec::new())),
            next_sub: Arc::new(AtomicU32::new(1)),
        }
    }
}
