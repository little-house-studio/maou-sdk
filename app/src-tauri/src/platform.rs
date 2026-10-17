//! 各 OS 的壳层差异：平台 id、hub socket 路径、窗口外观、macOS 菜单。

use std::path::Path;
use std::time::Duration;

use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const MAIN_WINDOW: &str = "main";

/// macOS sun_path 104 字节（含 NUL），留点余量。
const SUN_PATH_MAX: usize = 100;

/// 与 Node `process.platform` 同值，渲染层据此画 `data-app-chrome`。
pub fn platform_id() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    }
}

/// unix：`<data>/run/app-<pid>.sock`，过长退到临时目录；win32：`\\.\pipe\maou-app-<pid>`。
pub fn hub_socket_path(data_dir: &Path, pid: u32) -> String {
    hub_socket_path_for(platform_id(), data_dir, &std::env::temp_dir(), pid)
}

fn hub_socket_path_for(os: &str, data_dir: &Path, temp_dir: &Path, pid: u32) -> String {
    if os == "win32" {
        return format!(r"\\.\pipe\maou-app-{pid}");
    }
    let preferred = data_dir
        .join("run")
        .join(format!("app-{pid}.sock"))
        .to_string_lossy()
        .into_owned();
    if preferred.len() <= SUN_PATH_MAX {
        return preferred;
    }
    temp_dir
        .join(format!("maou-app-{pid}.sock"))
        .to_string_lossy()
        .into_owned()
}

/// 页面脚本之前注入：渲染层靠它认出桌面壳和平台（替代原 preload 的 `platform`）。
pub fn init_script() -> String {
    format!(
        "Object.defineProperty(window,'__MAOU_DESKTOP__',{{value:Object.freeze({{kind:'desktop',shell:'tauri',platform:'{}'}}),configurable:false}});",
        platform_id()
    )
}

/// 主窗口：已有就拉到前台，没有就新建。
pub fn open_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(win);
    }
    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::default())
        .title("Maou")
        .inner_size(1280.0, 800.0)
        .min_inner_size(880.0, 560.0)
        .background_color(Color(0xed, 0xed, 0xed, 0xff))
        .zoom_hotkeys_enabled(true)
        .visible(false)
        .initialization_script(init_script());
    // hiddenInset：红绿灯压在 40px 顶栏上，顶栏自己是拖拽条
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 13.0));
    let win = builder.build()?;

    // ready-to-show 兜底：页面迟迟不 finish 也要露出窗口
    let late = win.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let _ = late.show();
    });
    Ok(win)
}

#[cfg(target_os = "macos")]
const MENU_RELOAD: &str = "maou-reload";
#[cfg(target_os = "macos")]
const MENU_DEVTOOLS: &str = "maou-devtools";

/// macOS 必须有菜单，否则 ⌘C/⌘V/⌘Q 都不生效。Windows / Linux 不挂菜单栏（原先也是自动隐藏）。
#[cfg(target_os = "macos")]
pub fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let app_menu = SubmenuBuilder::new(app, "Maou")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let reload = MenuItemBuilder::with_id(MENU_RELOAD, "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let devtools = MenuItemBuilder::with_id(MENU_DEVTOOLS, "Toggle Developer Tools")
        .accelerator("Alt+CmdOrCtrl+I")
        .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&reload)
        .item(&devtools)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &view, &window])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let Some(win) = app.get_webview_window(MAIN_WINDOW) else {
            return;
        };
        match event.id().as_ref() {
            MENU_RELOAD => {
                let _ = win.reload();
            }
            MENU_DEVTOOLS => {
                if win.is_devtools_open() {
                    win.close_devtools();
                } else {
                    win.open_devtools();
                }
            }
            _ => {}
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install_menu(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn darwin_and_linux_use_a_unix_socket() {
        let data = PathBuf::from("/tmp/maou-user");
        let tmp = PathBuf::from("/tmp");
        for os in ["darwin", "linux"] {
            let p = hub_socket_path_for(os, &data, &tmp, 42);
            assert!(p.ends_with("app-42.sock"), "{p}");
            assert!(p.contains("run"), "{p}");
            assert!(!p.starts_with(r"\\"), "{p}");
        }
    }

    #[test]
    fn win32_uses_a_named_pipe() {
        let p = hub_socket_path_for("win32", Path::new(r"C:\Users\x"), Path::new(r"C:\Temp"), 7);
        assert_eq!(p, r"\\.\pipe\maou-app-7");
    }

    #[test]
    fn long_data_dir_falls_back_to_temp() {
        let data = PathBuf::from(format!(
            "/Users/{}/Library/Application Support/x",
            "u".repeat(80)
        ));
        let p = hub_socket_path_for("darwin", &data, Path::new("/tmp"), 9);
        assert!(p.len() <= SUN_PATH_MAX, "{p}");
        assert!(p.ends_with("maou-app-9.sock"), "{p}");
    }

    #[test]
    fn init_script_exposes_platform() {
        let s = init_script();
        assert!(s.contains("__MAOU_DESKTOP__"));
        assert!(s.contains(&format!("platform:'{}'", platform_id())));
    }
}
