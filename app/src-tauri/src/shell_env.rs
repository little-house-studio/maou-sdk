//! 从 Finder / Dock / 开始菜单启动时拿不到登录 shell 的 PATH。
//! hub 要靠 PATH 找 node，Agent 开的终端也要 git / cargo 等，所以这里补齐。

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const MIN_NODE_MAJOR: u32 = 20;
const MARK: &str = "__MAOU_PATH__";

/// hub 子进程的 PATH，以及其上的 node。
pub struct HubRuntime {
    pub path_env: OsString,
    pub node: PathBuf,
    pub node_version: String,
}

pub fn resolve_runtime() -> Result<HubRuntime, String> {
    let current = std::env::var_os("PATH").unwrap_or_default();

    if let Some(explicit) = std::env::var_os("MAOU_NODE").filter(|v| !v.is_empty()) {
        let node = PathBuf::from(explicit);
        if !node.is_file() {
            return Err(format!("MAOU_NODE 指向的文件不存在：{}", node.display()));
        }
        let node_version = check_node_version(&node)?;
        return Ok(HubRuntime {
            path_env: current,
            node,
            node_version,
        });
    }

    if let Some(node) = find_in_path("node", &current) {
        let node_version = check_node_version(&node)?;
        return Ok(HubRuntime {
            path_env: current,
            node,
            node_version,
        });
    }

    // GUI 启动：问登录 shell，再补常见安装位置
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(login) = login_shell_path() {
        dirs.extend(std::env::split_paths(&login));
    }
    dirs.extend(std::env::split_paths(&current));
    dirs.extend(fallback_node_dirs());
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
    let merged = std::env::join_paths(&dirs).map_err(|e| format!("PATH 拼接失败：{e}"))?;

    let node = find_in_path("node", &merged).ok_or_else(|| {
        format!(
            "找不到 Node.js（需要 >= {MIN_NODE_MAJOR}）。安装后重开 Maou，或设置 MAOU_NODE=/path/to/node"
        )
    })?;
    let node_version = check_node_version(&node)?;
    Ok(HubRuntime {
        path_env: merged,
        node,
        node_version,
    })
}

fn check_node_version(node: &Path) -> Result<String, String> {
    let mut cmd = Command::new(node);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("无法运行 {}：{e}", node.display()))?;
    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
    match parse_node_major(&version) {
        Some(major) if major >= MIN_NODE_MAJOR => Ok(version),
        Some(_) => Err(format!(
            "Node.js {version}（{}）太旧，需要 >= {MIN_NODE_MAJOR}",
            node.display()
        )),
        None => Err(format!(
            "{} 不像 Node.js（--version 输出：{version:?}）",
            node.display()
        )),
    }
}

fn parse_node_major(version: &str) -> Option<u32> {
    version
        .trim()
        .strip_prefix('v')?
        .split('.')
        .next()?
        .parse()
        .ok()
}

pub fn find_in_path(name: &str, path_env: &OsString) -> Option<PathBuf> {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    std::env::split_paths(path_env)
        .map(|dir| dir.join(&file))
        .find(|candidate| is_executable(candidate))
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(p: &Path) -> bool {
    p.is_file()
}

#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_console(_cmd: &mut Command) {}

/// `$SHELL -ilc` 打印 PATH；rc 里的杂讯靠前后标记切掉，5 秒不回就放弃。
#[cfg(unix)]
fn login_shell_path() -> Option<OsString> {
    use std::io::Read;
    use std::time::{Duration, Instant};

    let shell = std::env::var_os("SHELL")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh"
            } else {
                "/bin/sh"
            }
            .into()
        });
    let is_fish = Path::new(&shell)
        .file_name()
        .is_some_and(|n| n.to_string_lossy().contains("fish"));
    let script = if is_fish {
        format!("printf '{MARK}%s{MARK}' (string join : $PATH)")
    } else {
        format!("printf '{MARK}%s{MARK}' \"$PATH\"")
    };
    let mut child = Command::new(&shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    parse_marked_path(&out).map(OsString::from)
}

#[cfg(not(unix))]
fn login_shell_path() -> Option<OsString> {
    None
}

fn parse_marked_path(out: &str) -> Option<String> {
    let start = out.find(MARK)? + MARK.len();
    let len = out[start..].find(MARK)?;
    let path = out[start..start + len].trim();
    (!path.is_empty()).then(|| path.to_string())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// 版本管理器 / 包管理器的常见落点。
fn fallback_node_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(pf).join("nodejs"));
        }
        if let Some(home) = home_dir() {
            dirs.push(home.join("AppData").join("Roaming").join("npm"));
            dirs.push(home.join(".volta").join("bin"));
        }
        return dirs;
    }
    for d in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/opt/local/bin",
        "/usr/bin",
    ] {
        dirs.push(PathBuf::from(d));
    }
    if let Some(home) = home_dir() {
        if let Some(nvm) = newest_nvm_bin(&home.join(".nvm").join("versions").join("node")) {
            dirs.push(nvm);
        }
        for rel in [
            ".volta/bin",
            ".local/share/mise/shims",
            ".asdf/shims",
            ".local/share/fnm/aliases/default/bin",
            "Library/Application Support/fnm/aliases/default/bin",
            "n/bin",
            ".local/bin",
        ] {
            dirs.push(home.join(rel));
        }
    }
    dirs
}

fn newest_nvm_bin(versions: &Path) -> Option<PathBuf> {
    let best = std::fs::read_dir(versions)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let parts: Vec<u32> = name
                .strip_prefix('v')?
                .split('.')
                .map(|p| p.parse().ok())
                .collect::<Option<_>>()?;
            Some((parts, e.path()))
        })
        .max_by(|a, b| a.0.cmp(&b.0))?;
    Some(best.1.join("bin"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_marked_path_through_rc_noise() {
        let out = format!("welcome!\n{MARK}/opt/homebrew/bin:/usr/bin{MARK}\nbye");
        assert_eq!(
            parse_marked_path(&out).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        assert_eq!(parse_marked_path("no marks"), None);
        assert_eq!(parse_marked_path(&format!("{MARK}{MARK}")), None);
    }

    #[test]
    fn parses_node_major() {
        assert_eq!(parse_node_major("v24.20.0\n"), Some(24));
        assert_eq!(parse_node_major("v18.0.0"), Some(18));
        assert_eq!(parse_node_major("garbage"), None);
    }

    #[test]
    fn picks_newest_nvm_version() {
        let root = std::env::temp_dir().join(format!("maou-nvm-{}", std::process::id()));
        for v in ["v18.20.1", "v22.3.0", "v22.10.0", "not-a-version"] {
            std::fs::create_dir_all(root.join(v).join("bin")).unwrap();
        }
        assert_eq!(
            newest_nvm_bin(&root),
            Some(root.join("v22.10.0").join("bin"))
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
