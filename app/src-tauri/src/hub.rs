//! Node hub 子进程（`dist/desktop/hub-main.js`，跑 AgentHub，只听 socket）。
//! 拉起 → 等 stdout 的 `hub-ready` → 意外退出重启一次 → 应用退出时收掉。

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, watch};

use crate::{platform, shell_env};

/// 与 `src/desktop/hub-ready.ts` 的 HUB_READY_LINE 一致。
pub const HUB_READY_LINE: &str = "hub-ready";
const READY_TIMEOUT: Duration = Duration::from_secs(30);
/// 渲染层请求最多等 hub 这么久。
const REQUEST_WAIT: Duration = Duration::from_secs(45);
const MAX_RESTARTS: u32 = 1;
const TERM_GRACE: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, PartialEq)]
pub enum HubState {
    Starting,
    Ready(String),
    Failed(String),
    Stopped,
}

#[derive(Clone)]
pub struct Hub {
    inner: Arc<Inner>,
}

struct Inner {
    state: watch::Sender<HubState>,
    stop: watch::Sender<bool>,
    socket: Mutex<Option<String>>,
}

struct Launch {
    node: PathBuf,
    hub_main: PathBuf,
    cwd: PathBuf,
    socket: String,
    env: Vec<(&'static str, OsString)>,
}

impl Hub {
    pub fn new() -> Self {
        let (state, _) = watch::channel(HubState::Starting);
        let (stop, _) = watch::channel(false);
        Self {
            inner: Arc::new(Inner {
                state,
                stop,
                socket: Mutex::new(None),
            }),
        }
    }

    /// 后台起 hub，不阻塞开窗；请求侧用 [`Hub::ready_socket`] 等就绪。
    pub fn start(&self, app: &AppHandle) {
        let inner = self.inner.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let prep_app = app.clone();
            let launch = tauri::async_runtime::spawn_blocking(move || prepare_launch(&prep_app))
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| r);
            match launch {
                Ok(launch) => {
                    *inner.socket.lock().unwrap() = Some(launch.socket.clone());
                    supervise(&app, &inner, launch).await;
                }
                Err(msg) => fail(&app, &inner, msg),
            }
        });
    }

    /// 测试用：直接指向一个已就绪的 socket。
    #[cfg(test)]
    pub fn ready_at(socket: &str) -> Self {
        let hub = Self::new();
        hub.inner
            .state
            .send_replace(HubState::Ready(socket.to_string()));
        hub
    }

    pub async fn ready_socket(&self) -> Result<String, String> {
        let mut rx = self.inner.state.subscribe();
        let wait = async {
            loop {
                match &*rx.borrow_and_update() {
                    HubState::Ready(socket) => return Ok(socket.clone()),
                    HubState::Failed(msg) => return Err(msg.clone()),
                    HubState::Stopped => return Err("hub 已停止".to_string()),
                    HubState::Starting => {}
                }
                if rx.changed().await.is_err() {
                    return Err("hub 已停止".to_string());
                }
            }
        };
        tokio::time::timeout(REQUEST_WAIT, wait)
            .await
            .map_err(|_| "等待 hub 就绪超时".to_string())?
    }

    /// 应用退出时同步调用：通知监管任务收掉子进程，最多等几秒。
    pub fn shutdown(&self) {
        let _ = self.inner.stop.send(true);
        let deadline = Instant::now() + TERM_GRACE + Duration::from_secs(1);
        while Instant::now() < deadline {
            if matches!(
                *self.inner.state.borrow(),
                HubState::Stopped | HubState::Failed(_)
            ) {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if let Some(socket) = self.inner.socket.lock().unwrap().take() {
            if !socket.starts_with(r"\\") {
                let _ = std::fs::remove_file(socket);
            }
        }
    }
}

fn prepare_launch(app: &AppHandle) -> Result<Launch, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("找不到应用数据目录：{e}"))?;
    let socket = platform::hub_socket_path(&data_dir, std::process::id());
    if !socket.starts_with(r"\\") {
        if let Some(dir) = Path::new(&socket).parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("建 socket 目录失败：{e}"))?;
        }
        let _ = std::fs::remove_file(&socket);
    }

    let candidates = hub_main_candidates(app);
    let hub_main = candidates
        .iter()
        .find(|p| p.is_file())
        .cloned()
        .ok_or_else(|| {
            let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
            format!(
                "找不到 hub-main.js（{}）。开发请先 pnpm --filter @little-house-studio/app build",
                tried.join(", ")
            )
        })?;
    // dist/desktop/hub-main.js → 包根（node_modules 所在）
    let cwd = hub_main
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let runtime = shell_env::resolve_runtime()?;
    let project_root = resolve_project_root(app);
    let sandbox = std::env::var("MAOU_SANDBOX_MODE")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "yolo".to_string());

    println!(
        "[maou-app] desktop {} ipc={socket}\n[maou-app] hub {}\n[maou-app] node {} ({})",
        platform::platform_id(),
        hub_main.display(),
        runtime.node.display(),
        runtime.node_version,
    );

    Ok(Launch {
        node: runtime.node,
        hub_main,
        cwd,
        env: vec![
            ("PATH", runtime.path_env),
            ("MAOU_APP_SOCKET", socket.clone().into()),
            ("MAOU_PROJECT_ROOT", project_root.into_os_string()),
            ("MAOU_SANDBOX_MODE", sandbox.into()),
            // hub 在 stdin EOF 时退出：壳被强杀也不留孤儿进程
            ("MAOU_HUB_PARENT_STDIN", "1".into()),
        ],
        socket,
    })
}

/// 覆盖 → 打包资源 → monorepo 构建产物。
fn hub_main_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = std::env::var_os("MAOU_APP_HUB_MAIN").filter(|v| !v.is_empty()) {
        out.push(PathBuf::from(p));
    }
    if let Ok(res) = app.path().resource_dir() {
        out.push(
            res.join("hub")
                .join("dist")
                .join("desktop")
                .join("hub-main.js"),
        );
    }
    out.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("dist")
            .join("desktop")
            .join("hub-main.js"),
    );
    out
}

/// MAOU_PROJECT_ROOT → cwd；`tauri dev` 的 cwd 是 src-tauri，退一级；Finder 启动 cwd 是 `/`，用家目录。
fn resolve_project_root(app: &AppHandle) -> PathBuf {
    if let Some(p) = std::env::var_os("MAOU_PROJECT_ROOT").filter(|v| !v.is_empty()) {
        return PathBuf::from(p);
    }
    let home = app.path().home_dir().ok();
    project_root_from_cwd(std::env::current_dir().ok(), home)
}

fn project_root_from_cwd(cwd: Option<PathBuf>, home: Option<PathBuf>) -> PathBuf {
    let fallback = || home.clone().unwrap_or_else(|| PathBuf::from("."));
    match cwd {
        Some(c) if c.file_name().is_some_and(|n| n == "src-tauri") => {
            c.parent().map(Path::to_path_buf).unwrap_or_else(fallback)
        }
        Some(c) if c.parent().is_none() => fallback(),
        Some(c) => c,
        None => fallback(),
    }
}

fn spawn_child(launch: &Launch) -> std::io::Result<Child> {
    let mut cmd = Command::new(&launch.node);
    cmd.arg(&launch.hub_main)
        .current_dir(&launch.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (k, v) in &launch.env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

async fn supervise(app: &AppHandle, inner: &Inner, launch: Launch) {
    let mut stop_rx = inner.stop.subscribe();
    let mut restarts = 0u32;
    loop {
        if *stop_rx.borrow() {
            inner.state.send_replace(HubState::Stopped);
            return;
        }
        inner.state.send_replace(HubState::Starting);
        let mut child = match spawn_child(&launch) {
            Ok(c) => c,
            Err(e) => {
                fail(
                    app,
                    inner,
                    format!("启动 hub 失败（{}）：{e}", launch.node.display()),
                );
                return;
            }
        };
        // 持有 stdin 到子进程结束；壳死了管道断开，hub 读到 EOF 自己退
        let stdin = child.stdin.take();
        let ready_rx = forward_output(&mut child);

        let ready = tokio::select! {
            r = tokio::time::timeout(READY_TIMEOUT, ready_rx) => match r {
                Ok(Ok(())) => Ok(()),
                Ok(Err(_)) => Err("hub 未就绪就退出了".to_string()),
                Err(_) => Err("等 hub-ready 超时".to_string()),
            },
            _ = stop_rx.changed() => {
                terminate(&mut child).await;
                inner.state.send_replace(HubState::Stopped);
                return;
            }
        };

        let exit_note = match ready {
            Ok(()) => {
                inner
                    .state
                    .send_replace(HubState::Ready(launch.socket.clone()));
                tokio::select! {
                    status = child.wait() => match status {
                        Ok(s) => format!("hub 退出（{s}）"),
                        Err(e) => format!("hub 退出（{e}）"),
                    },
                    _ = stop_rx.changed() => {
                        terminate(&mut child).await;
                        inner.state.send_replace(HubState::Stopped);
                        return;
                    }
                }
            }
            Err(msg) => {
                terminate(&mut child).await;
                msg
            }
        };
        drop(stdin);
        eprintln!("[maou-app] {exit_note}");

        if restarts >= MAX_RESTARTS {
            fail(
                app,
                inner,
                format!("{exit_note}，已重启过 {MAX_RESTARTS} 次，放弃"),
            );
            return;
        }
        restarts += 1;
        eprintln!("[maou-app] restarting hub");
    }
}

/// stdout / stderr 原样转发到壳的输出；看到 hub-ready 行就放行。
fn forward_output(child: &mut Child) -> oneshot::Receiver<()> {
    let (ready_tx, ready_rx) = oneshot::channel();
    if let Some(stdout) = child.stdout.take() {
        tauri::async_runtime::spawn(async move {
            let mut ready_tx = Some(ready_tx);
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                println!("{line}");
                if line.trim() == HUB_READY_LINE {
                    if let Some(tx) = ready_tx.take() {
                        let _ = tx.send(());
                    }
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("{line}");
            }
        });
    }
    ready_rx
}

/// unix 先 SIGTERM 让 hub 自己关 server，超时再强杀；Windows 直接结束进程。
async fn terminate(child: &mut Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // SAFETY: kill(2) 只发信号，pid 是自己拉起、尚未回收的子进程
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
        if tokio::time::timeout(TERM_GRACE, child.wait()).await.is_ok() {
            return;
        }
    }
    let _ = child.kill().await;
}

fn fail(app: &AppHandle, inner: &Inner, msg: String) {
    eprintln!("[maou-app] {msg}");
    inner.state.send_replace(HubState::Failed(msg.clone()));
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    app.dialog()
        .message(msg)
        .title("Maou 后台服务没有起来")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_root_rules() {
        let home = Some(PathBuf::from("/Users/u"));
        assert_eq!(
            project_root_from_cwd(Some(PathBuf::from("/repo/app/src-tauri")), home.clone()),
            PathBuf::from("/repo/app")
        );
        assert_eq!(
            project_root_from_cwd(Some(PathBuf::from("/")), home.clone()),
            PathBuf::from("/Users/u")
        );
        assert_eq!(
            project_root_from_cwd(Some(PathBuf::from("/work/proj")), home.clone()),
            PathBuf::from("/work/proj")
        );
        assert_eq!(project_root_from_cwd(None, home), PathBuf::from("/Users/u"));
    }

    #[tokio::test]
    async fn ready_socket_resolves_and_fails() {
        let hub = Hub::new();
        let waiter = {
            let hub = hub.clone();
            tokio::spawn(async move { hub.ready_socket().await })
        };
        tokio::task::yield_now().await;
        hub.inner
            .state
            .send_replace(HubState::Ready("/tmp/x.sock".into()));
        assert_eq!(waiter.await.unwrap(), Ok("/tmp/x.sock".to_string()));

        hub.inner
            .state
            .send_replace(HubState::Failed("boom".into()));
        assert_eq!(hub.ready_socket().await, Err("boom".to_string()));
    }
}
