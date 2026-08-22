/**
 * filter.rs — 命令过滤系统（引擎层兜底）
 *
 * 破坏性命令的主策略已迁移到 TypeScript 层的 **DCG**（Destructive Command Guard）
 * + maou-hard-deny。本模块保留：
 *   1. 可选预设黑名单（默认 **关闭**，避免与 DCG 双拦/规则落后）
 *   2. 自定义黑名单（regex）
 *   3. 自定义白名单（regex，覆盖黑名单）
 *   4. 白名单模式 / JSON 配置加载
 *
 * 预设列表仅作 DCG 不可用时的紧急兜底（手动打开 preset_blacklist_enabled）。
 */

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// 紧急兜底预设（默认关闭；完整规则见 DCG packs + maou-hard-deny）
const PRESET_BLACKLIST: &[&str] = &[
    r"rm\s+-rf\s+/",          // rm -rf /
    r"rm\s+-rf\s+~",          // rm -rf ~
    r"mkfs\.",                // mkfs.*
    r"dd\s+if=.*of=/dev/",    // dd to device
    r":\(\)\{\s*:\|:&\s*\};:",// fork bomb
    r"\b(shutdown|reboot|halt|poweroff)\b",
];

/// 过滤器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterConfig {
    /// 是否启用预设黑名单（默认 true）
    pub preset_blacklist_enabled: bool,
    /// 自定义黑名单（regex 模式）
    pub blacklist: Vec<String>,
    /// 自定义白名单（regex 模式，覆盖黑名单）
    pub whitelist: Vec<String>,
    /// 是否启用白名单模式（仅白名单中的命令可执行）
    pub whitelist_mode: bool,
}

impl Default for FilterConfig {
    fn default() -> Self {
        Self {
            // 默认关：主路径用 DCG；需要引擎层兜底时显式打开
            preset_blacklist_enabled: false,
            blacklist: Vec::new(),
            whitelist: Vec::new(),
            whitelist_mode: false,
        }
    }
}

/// 从 JSON 文件加载配置
#[derive(Debug, Clone, Serialize, Deserialize)]
struct FilterFile {
    blacklist: Option<Vec<String>>,
    whitelist: Option<Vec<String>>,
    whitelist_mode: Option<bool>,
    preset_blacklist_enabled: Option<bool>,
}

/// 命令过滤器
pub struct CommandFilter {
    config: Arc<std::sync::RwLock<FilterConfig>>,
    preset_patterns: Vec<Regex>,
    blacklist_patterns: Vec<Regex>,
    whitelist_patterns: Vec<Regex>,
}

impl CommandFilter {
    /// 创建新的过滤器
    pub fn new() -> Self {
        let preset_patterns = PRESET_BLACKLIST
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect();

        Self {
            config: Arc::new(std::sync::RwLock::new(FilterConfig::default())),
            preset_patterns,
            blacklist_patterns: Vec::new(),
            whitelist_patterns: Vec::new(),
        }
    }

    /// 更新过滤器配置
    pub fn update_config(&mut self, config: FilterConfig) {
        self.blacklist_patterns = config.blacklist.iter().filter_map(|p| Regex::new(p).ok()).collect();
        self.whitelist_patterns = config.whitelist.iter().filter_map(|p| Regex::new(p).ok()).collect();
        *self.config.write().unwrap() = config;
    }

    /// 从 JSON 文件加载配置
    pub fn load_from_file(&mut self, path: &str) -> Result<(), String> {
        let content = std::fs::read_to_string(path).map_err(|e| format!("读取过滤器配置文件失败: {}", e))?;
        let file: FilterFile = serde_json::from_str(&content).map_err(|e| format!("解析过滤器配置失败: {}", e))?;

        let mut config = self.config.write().unwrap();
        if let Some(bl) = file.blacklist { config.blacklist = bl; }
        if let Some(wl) = file.whitelist { config.whitelist = wl; }
        if let Some(wm) = file.whitelist_mode { config.whitelist_mode = wm; }
        if let Some(pe) = file.preset_blacklist_enabled { config.preset_blacklist_enabled = pe; }
        drop(config);

        // 重新编译 patterns
        let config = self.config.read().unwrap();
        self.blacklist_patterns = config.blacklist.iter().filter_map(|p| Regex::new(p).ok()).collect();
        self.whitelist_patterns = config.whitelist.iter().filter_map(|p| Regex::new(p).ok()).collect();
        Ok(())
    }

    /// 检查命令是否允许执行
    /// 返回 Ok(()) 表示允许，Err(reason) 表示拒绝
    pub fn check(&self, command: &str) -> Result<(), String> {
        let config = self.config.read().unwrap();

        // 白名单模式：仅白名单中的命令可执行
        if config.whitelist_mode {
            let whitelisted = self.whitelist_patterns.iter().any(|p| p.is_match(command));
            if !whitelisted {
                return Err(format!("命令不在白名单中（白名单模式已启用）"));
            }
            return Ok(());
        }

        // 先检查白名单（覆盖黑名单）
        let whitelisted = self.whitelist_patterns.iter().any(|p| p.is_match(command));

        // 预设黑名单
        if config.preset_blacklist_enabled && !whitelisted {
            for (i, pattern) in self.preset_patterns.iter().enumerate() {
                if pattern.is_match(command) {
                    return Err(format!("命中预设危险命令规则 #{}: {}", i + 1, PRESET_BLACKLIST[i]));
                }
            }
        }

        // 自定义黑名单
        if !whitelisted {
            for pattern in &self.blacklist_patterns {
                if pattern.is_match(command) {
                    return Err(format!("命中自定义黑名单规则: {}", pattern.as_str()));
                }
            }
        }

        Ok(())
    }

    /// 获取当前配置
    pub fn get_config(&self) -> FilterConfig {
        self.config.read().unwrap().clone()
    }
}

impl Default for CommandFilter {
    fn default() -> Self {
        Self::new()
    }
}
