/**
 * persistence.rs — 原子持久化
 *
 * - 写入临时文件 → rename（原子操作）
 * - 持久化元数据 + ring buffer
 * - 加载时恢复终端列表（running → interrupted）
 */

use crate::terminal::PersistedTerminal;
use serde_json;
use std::io::Write;
use std::path::PathBuf;

/// 持久化管理器
pub struct Persistence {
    path: Option<PathBuf>,
}

impl Persistence {
    pub fn new() -> Self {
        Self { path: None }
    }

    /// 设置持久化路径
    pub fn set_path(&mut self, path: &str) {
        self.path = Some(PathBuf::from(path));
        // 确保父目录存在
        if let Some(parent) = self.path.as_ref().and_then(|p| p.parent()) {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    /// 保存（原子写：临时文件 → rename）
    pub fn save(&self, entries: &[PersistedTerminal]) -> Result<(), String> {
        let path = self.path.as_ref().ok_or("持久化路径未设置")?;

        let json = serde_json::to_string_pretty(entries)
            .map_err(|e| format!("序列化失败: {}", e))?;

        // 写入临时文件
        let tmp_path = path.with_extension("json.tmp");
        let mut file = std::fs::File::create(&tmp_path)
            .map_err(|e| format!("创建临时文件失败: {}", e))?;

        file.write_all(json.as_bytes())
            .map_err(|e| format!("写入失败: {}", e))?;

        file.sync_all()
            .map_err(|e| format!("sync 失败: {}", e))?;

        drop(file);

        // 原子 rename
        std::fs::rename(&tmp_path, path)
            .map_err(|e| format!("rename 失败: {}", e))?;

        Ok(())
    }

    /// 加载
    pub fn load(&self) -> Result<Vec<PersistedTerminal>, String> {
        let path = self.path.as_ref().ok_or("持久化路径未设置")?;

        if !path.exists() {
            return Ok(Vec::new());
        }

        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("读取失败: {}", e))?;

        // 如果文件为空，返回空列表
        if content.trim().is_empty() {
            return Ok(Vec::new());
        }

        let entries: Vec<PersistedTerminal> = serde_json::from_str(&content)
            .map_err(|e| format!("反序列化失败: {}", e))?;

        Ok(entries)
    }
}
