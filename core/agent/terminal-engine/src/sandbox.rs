/**
 * sandbox.rs — V1 沙箱（路径限制 + 命令过滤 + 提示词注入）
 *
 * V2 将添加 OS 级隔离：
 * - Linux: seccomp + namespaces
 * - macOS: sandbox-exec
 * - Windows: Job Objects
 */

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 沙箱配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    /// 是否启用沙箱
    pub enabled: bool,
    /// 允许读写的路径白名单
    pub allowed_paths: Vec<String>,
    /// 禁止访问的路径黑名单
    pub denied_paths: Vec<String>,
    /// 是否注入提示词到 before_user
    pub inject_prompt: bool,
    /// 注入的提示词内容
    pub prompt_text: Option<String>,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            allowed_paths: Vec::new(),
            denied_paths: Vec::new(),
            inject_prompt: false,
            prompt_text: None,
        }
    }
}

/// V1 沙箱
pub struct Sandbox {
    pub enabled: bool,
    pub allowed_paths: Vec<PathBuf>,
    pub denied_paths: Vec<PathBuf>,
    pub inject_prompt: bool,
    pub prompt_text: Option<String>,
}

impl Sandbox {
    pub fn default() -> Self {
        Self {
            enabled: false,
            allowed_paths: Vec::new(),
            denied_paths: Vec::new(),
            inject_prompt: false,
            prompt_text: None,
        }
    }

    /// 更新配置
    pub fn update_config(&mut self, config: SandboxConfig) {
        self.enabled = config.enabled;
        self.allowed_paths = config.allowed_paths.iter().map(PathBuf::from).collect();
        self.denied_paths = config.denied_paths.iter().map(PathBuf::from).collect();
        self.inject_prompt = config.inject_prompt;
        self.prompt_text = config.prompt_text;
    }

    /// 检查路径是否允许访问
    pub fn check_path(&self, path: &str) -> Result<(), String> {
        let path_buf = PathBuf::from(path);
        let canonical = path_buf.canonicalize().unwrap_or(path_buf);

        // 先检查黑名单
        for denied in &self.denied_paths {
            let denied_canonical = denied.canonicalize().unwrap_or(denied.clone());
            if canonical.starts_with(&denied_canonical) {
                return Err(format!("路径 {} 在黑名单中", path));
            }
        }

        // 如果有白名单，检查路径是否在白名单中
        if !self.allowed_paths.is_empty() {
            let allowed = self.allowed_paths.iter().any(|allowed_path| {
                let allowed_canonical = allowed_path.canonicalize().unwrap_or(allowed_path.clone());
                canonical.starts_with(&allowed_canonical)
            });
            if !allowed {
                return Err(format!("路径 {} 不在白名单中", path));
            }
        }

        Ok(())
    }

    /// 获取注入的提示词（如果有）
    pub fn get_injected_prompt(&self) -> Option<String> {
        if self.inject_prompt {
            self.prompt_text.clone().or_else(|| {
                Some(
                    "⚠️ 沙箱已启用：你的终端操作受路径限制。仅允许访问白名单中的路径，禁止访问系统关键目录。"
                        .to_string(),
                )
            })
        } else {
            None
        }
    }
}
