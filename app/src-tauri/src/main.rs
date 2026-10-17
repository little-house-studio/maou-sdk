//! Maou 桌面客户端的 Tauri 壳。业务全在 Node hub（AgentHub），这里只负责：
//! 拉起 hub、开窗、把渲染层的 /api 与 /ws 转到 hub 的 socket、提供系统对话框。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hub;
mod native;
mod platform;
mod proxy;
mod shell_env;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent};

fn main() {
    let hub = hub::Hub::new();
    let relays = proxy::Relays::default();
    let page_relays = relays.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(hub.clone())
        .manage(relays)
        .invoke_handler(tauri::generate_handler![
            proxy::hub_http_start,
            proxy::hub_http_abort,
            proxy::hub_ws_open,
            proxy::hub_ws_send,
            proxy::hub_ws_close,
            native::pick_folder,
            native::reveal_in_folder,
            native::open_path,
        ])
        .on_page_load(move |webview, payload| match payload.event() {
            // 重载后旧页面的流和终端中继全部作废
            PageLoadEvent::Started => page_relays.reset(),
            PageLoadEvent::Finished => {
                if let Some(win) = webview.app_handle().get_webview_window(webview.label()) {
                    let _ = win.show();
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle();
            hub.start(handle);
            platform::install_menu(handle)?;
            platform::open_main_window(handle)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build maou-app");

    app.run(|app, event| match event {
        // macOS 关掉最后一个窗口不退出（Dock 点图标再开）；⌘Q 等显式退出带 code，照常退
        #[cfg(target_os = "macos")]
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            let _ = platform::open_main_window(app);
        }
        RunEvent::Exit => {
            app.state::<proxy::Relays>().reset();
            app.state::<hub::Hub>().shutdown();
        }
        _ => {}
    });
}
