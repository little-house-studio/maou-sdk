//! 系统能力：选文件夹、在文件夹中显示、用默认应用打开。

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub struct PickFolder {
    path: Option<String>,
}

#[derive(Serialize)]
pub struct OpResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl OpResult {
    fn from(r: Result<(), String>) -> Self {
        match r {
            Ok(()) => Self {
                ok: true,
                error: None,
            },
            Err(e) => Self {
                ok: false,
                error: Some(e),
            },
        }
    }
}

#[tauri::command]
pub async fn pick_folder(window: tauri::Window) -> Result<PickFolder, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_can_create_directories(true)
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    Ok(PickFolder {
        path: picked
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> OpResult {
    let path = path.trim();
    if path.is_empty() {
        return OpResult::from(Err("empty path".into()));
    }
    OpResult::from(tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn open_path(path: String) -> OpResult {
    let path = path.trim();
    if path.is_empty() {
        return OpResult::from(Err("empty path".into()));
    }
    OpResult::from(tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string()))
}
