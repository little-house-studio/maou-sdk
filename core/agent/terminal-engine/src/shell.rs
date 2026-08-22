/**
 * shell.rs — 跨平台 shell 包装 + 子进程环境（对齐 Grok shell_command_argv / env overrides）
 *
 * 业务层只调：
 *   - shell_command_argv(command)  → 如何执行用户命令字符串
 *   - apply_capture_env / apply_interactive_env
 *   - pager_env()
 *
 * 禁止在 spawn_pipe / spawn_pty 里各自手写 cmd.exe / bash -c。
 */

use std::collections::HashMap;
use std::process::Command as StdCommand;

/// 用户命令 → 可 spawn 的 program + args（及特殊 Windows raw 尾参）
#[derive(Debug, Clone)]
pub struct ShellInvocation {
    pub program: String,
    pub args: Vec<String>,
    /// Windows cmd：整段 `/c` 载荷需 raw_arg，避免二次转义
    pub windows_cmd_raw_c: Option<String>,
    /// 必须写入子进程的额外 env
    pub extra_env: Vec<(String, String)>,
}

/// 将 agent 给出的 shell 命令字符串解析为跨平台 invocation。
pub fn shell_command_argv(command: &str) -> ShellInvocation {
    #[cfg(windows)]
    {
        windows_cmd_invocation(command)
    }
    #[cfg(not(windows))]
    {
        unix_shell_invocation(command)
    }
}

#[cfg(not(windows))]
fn unix_shell_invocation(command: &str) -> ShellInvocation {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    ShellInvocation {
        program: shell,
        // 非 login：避免 MOTD / 慢 rc；与「管道抓取」模型一致
        args: vec!["-c".to_string(), command.to_string()],
        windows_cmd_raw_c: None,
        extra_env: vec![],
    }
}

/// Windows：固定用 cmd.exe（路径绝对），引号语义对齐 Node shell:true。
/// 暂不自动探测 Git Bash / pwsh（可后续扩展）；优先「全平台行为可预期」。
#[cfg(windows)]
fn windows_cmd_invocation(command: &str) -> ShellInvocation {
    let root = windows_system_root();
    let comspec = std::env::var("ComSpec")
        .or_else(|_| std::env::var("COMSPEC"))
        .unwrap_or_else(|_| format!(r"{}\System32\cmd.exe", root));

    // /d 禁 AutoRun，/s + 包引号：与 Node child_process shell:true 一致
    let mut wrapped = String::with_capacity(command.len() + 2);
    wrapped.push('"');
    wrapped.push_str(command);
    wrapped.push('"');

    ShellInvocation {
        program: comspec,
        args: vec!["/d".to_string(), "/s".to_string(), "/c".to_string()],
        windows_cmd_raw_c: Some(wrapped),
        extra_env: vec![
            ("PYTHONUTF8".into(), "1".into()),
            ("PYTHONIOENCODING".into(), "utf-8:surrogateescape".into()),
        ],
    }
}

#[cfg(windows)]
fn windows_system_root() -> String {
    std::env::var("SystemRoot")
        .or_else(|_| std::env::var("SYSTEMROOT"))
        .or_else(|_| std::env::var("windir"))
        .unwrap_or_else(|_| r"C:\Windows".to_string())
}

/// 禁止交互 pager/editor 抢 TTY（管道与 agent 场景必备）
pub fn pager_env() -> HashMap<String, String> {
    #[cfg(windows)]
    let passthrough = "more.com";
    #[cfg(not(windows))]
    let passthrough = "cat";

    #[cfg(windows)]
    let noop = "cmd.exe /c exit 0";
    #[cfg(not(windows))]
    let noop = "true";

    HashMap::from([
        ("PAGER".into(), passthrough.into()),
        ("GIT_PAGER".into(), passthrough.into()),
        ("GH_PAGER".into(), passthrough.into()),
        ("MANPAGER".into(), passthrough.into()),
        ("AWS_PAGER".into(), String::new()),
        ("SYSTEMD_PAGER".into(), passthrough.into()),
        ("GIT_EDITOR".into(), noop.into()),
        ("GIT_SEQUENCE_EDITOR".into(), noop.into()),
        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
        ("GPG_TTY".into(), String::new()),
    ])
}

/// 管道抓取模式环境：无颜色、dumb TERM、白名单基境 + pager 压制
pub fn capture_env() -> Vec<(String, String)> {
    let mut env = base_safe_env();
    env.push(("TERM".into(), "dumb".into()));
    env.push(("NO_COLOR".into(), "1".into()));
    env.push(("FORCE_COLOR".into(), "0".into()));
    for (k, v) in pager_env() {
        env.push((k, v));
    }
    // 去重：后写覆盖
    dedupe_env(env)
}

/// 交互 PTY 模式：保留 xterm 色，仍压制 pager
pub fn interactive_env() -> Vec<(String, String)> {
    let mut env = base_safe_env();
    env.push(("TERM".into(), "xterm-256color".into()));
    env.push(("COLORTERM".into(), "truecolor".into()));
    for (k, v) in pager_env() {
        env.push((k, v));
    }
    dedupe_env(env)
}

fn dedupe_env(pairs: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut map = HashMap::new();
    for (k, v) in pairs {
        map.insert(k, v);
    }
    map.into_iter().collect()
}

/// 从父进程挑白名单变量；Windows 额外净化 PATH
fn base_safe_env() -> Vec<(String, String)> {
    #[cfg(windows)]
    {
        let root = windows_system_root();
        let system32 = format!(r"{}\System32", root);
        let raw_path = std::env::var("Path")
            .or_else(|_| std::env::var("PATH"))
            .unwrap_or_default();
        let clean_path = sanitize_windows_path(&raw_path, &root, &system32);

        let mut env = vec![
            ("Path".into(), clean_path.clone()),
            ("PATH".into(), clean_path),
            ("SystemRoot".into(), root.clone()),
            ("windir".into(), root.clone()),
            ("ComSpec".into(), format!(r"{}\cmd.exe", system32)),
            (
                "SystemDrive".into(),
                root.get(..2).unwrap_or("C:").to_string(),
            ),
            (
                "PATHEXT".into(),
                std::env::var("PATHEXT").unwrap_or_else(|_| {
                    ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC".into()
                }),
            ),
        ];
        for key in [
            "USERPROFILE",
            "USERNAME",
            "APPDATA",
            "LOCALAPPDATA",
            "TEMP",
            "TMP",
            "HOME",
            "USER",
        ] {
            if let Ok(v) = std::env::var(key) {
                env.push((key.into(), v));
            }
        }
        env
    }
    #[cfg(not(windows))]
    {
        const WHITELIST: &[&str] = &[
            "PATH",
            "HOME",
            "USER",
            "USERNAME",
            "SHELL",
            "LANG",
            "LC_ALL",
            "LC_CTYPE",
            "TMPDIR",
            "TMP",
            "TEMP",
            "JAVA_HOME",
            "NODE_PATH",
            "PYTHONPATH",
            "GOPATH",
            "GOROOT",
            "RUSTUP_HOME",
            "CARGO_HOME",
            "NVM_DIR",
            "CONDA_PREFIX",
        ];
        WHITELIST
            .iter()
            .filter_map(|&k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
            .collect()
    }
}

#[cfg(windows)]
fn sanitize_windows_path(raw: &str, root: &str, system32: &str) -> String {
    let mut segs: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let mut push = |segs: &mut Vec<String>, seen: &mut std::collections::HashSet<String>, s: String| {
        let key = s.to_ascii_lowercase();
        if s.is_empty() || seen.contains(&key) {
            return;
        }
        seen.insert(key);
        segs.push(s);
    };

    push(&mut segs, &mut seen, system32.to_string());
    push(&mut segs, &mut seen, root.to_string());
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
        if s.is_empty() || s.contains('\n') || s.contains('\r') {
            continue;
        }
        if s.starts_with("/c/")
            || s.starts_with("/C/")
            || s.starts_with(r"\c\")
            || s.starts_with("/usr/")
            || s.starts_with("/mingw")
        {
            continue;
        }
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

/// 把 ShellInvocation 填进 std::process::Command（管道模式）
pub fn apply_invocation_to_std(cmd: &mut StdCommand, inv: &ShellInvocation) {
    cmd.args(&inv.args);
    #[cfg(windows)]
    if let Some(ref raw) = inv.windows_cmd_raw_c {
        use std::os::windows::process::CommandExt;
        cmd.raw_arg(raw);
    }
    for (k, v) in &inv.extra_env {
        cmd.env(k, v);
    }
}

/// 把 env 列表应用到 Command（后写覆盖）
pub fn apply_env_list(cmd: &mut StdCommand, env: &[(String, String)]) {
    for (k, v) in env {
        cmd.env(k, v);
    }
}

/// 规范化 cwd：空 → 当前目录；Windows 反斜杠；不存在则回退
pub fn normalize_cwd(cwd: &str) -> String {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| {
                if cfg!(windows) {
                    r"C:\".into()
                } else {
                    "/".into()
                }
            });
    }
    #[cfg(windows)]
    {
        let p = trimmed.replace('/', r"\");
        if std::path::Path::new(&p).is_dir() {
            p
        } else {
            std::env::current_dir()
                .map(|d| d.to_string_lossy().into_owned())
                .unwrap_or(p)
        }
    }
    #[cfg(not(windows))]
    {
        // 尽量 canonicalize，失败则原样（允许尚未创建的目录由 shell 自己报错）
        let path = std::path::Path::new(trimmed);
        path.canonicalize()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| trimmed.to_string())
    }
}
