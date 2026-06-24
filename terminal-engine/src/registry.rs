/**
 * registry.rs — 终端注册表
 *
 * - DashMap 并发安全，支持 200 并行
 * - Agent 级隔离
 * - 持久化（原子写）
 * - 状态面板生成
 */

use crate::error::{TerminalError, TerminalResult};
use crate::filter::CommandFilter;
use crate::persistence::Persistence;
use crate::sandbox::Sandbox;
use crate::terminal::{CreateOptions, PersistedTerminal, Terminal, TerminalState};
use dashmap::DashMap;
use std::sync::Arc;

/// 最大并行终端数
const MAX_TERMINALS: usize = 200;

/// 终端注册表
pub struct TerminalRegistry {
    /// id → Terminal
    terminals: Arc<DashMap<String, Arc<std::sync::Mutex<Terminal>>>>,
    /// 命令过滤器
    filter: Arc<std::sync::RwLock<CommandFilter>>,
    /// 沙箱
    sandbox: Arc<std::sync::RwLock<Sandbox>>,
    /// 持久化
    persistence: Arc<std::sync::RwLock<Persistence>>,
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(DashMap::new()),
            filter: Arc::new(std::sync::RwLock::new(CommandFilter::new())),
            sandbox: Arc::new(std::sync::RwLock::new(Sandbox::default())),
            persistence: Arc::new(std::sync::RwLock::new(Persistence::new())),
        }
    }

    /// 设置持久化路径并加载
    pub fn set_persist_path(&self, path: &str) {
        let mut p = self.persistence.write().unwrap();
        p.set_path(path);
        // 加载已持久化的终端
        if let Ok(entries) = p.load() {
            for entry in entries {
                let terminal = Terminal::from_persisted(entry);
                let id = terminal.id.clone();
                self.terminals
                    .insert(id, Arc::new(std::sync::Mutex::new(terminal)));
            }
        }
    }

    /// 创建终端
    pub fn create(
        &self,
        opts: CreateOptions,
        command: &str,
    ) -> TerminalResult<String> {
        // 检查数量上限
        if self.terminals.len() >= MAX_TERMINALS {
            return Err(TerminalError::MaxTerminalsReached(MAX_TERMINALS));
        }

        // 检查 ID 是否已存在且正在运行
        if let Some(entry) = self.terminals.get(&opts.id) {
            let terminal = entry.lock().unwrap();
            if terminal.is_running() {
                return Err(TerminalError::AlreadyRunning(opts.id.clone()));
            }
            // 已退出的终端，移除后重建
            drop(terminal);
            drop(entry);
            self.terminals.remove(&opts.id);
        }

        // 命令过滤
        let filter = self.filter.read().unwrap();
        if let Err(reason) = filter.check(command) {
            return Err(TerminalError::CommandBlocked(command.to_string(), reason));
        }
        drop(filter);

        // 沙箱路径检查
        let sandbox = self.sandbox.read().unwrap();
        if sandbox.enabled {
            if let Err(reason) = sandbox.check_path(&opts.cwd) {
                return Err(TerminalError::PathDenied(reason));
            }
        }
        drop(sandbox);

        // 创建终端
        let terminal = Terminal::spawn(opts.clone(), command)?;
        let id = terminal.id.clone();

        self.terminals
            .insert(id.clone(), Arc::new(std::sync::Mutex::new(terminal)));

        // 持久化
        self.persist_all();

        Ok(id)
    }

    /// 写入（键盘输入模拟）
    pub fn write(&self, id: &str, agent_name: &str, data: &str) -> TerminalResult<()> {
        let entry = self
            .terminals
            .get(id)
            .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;

        let terminal = entry.lock().unwrap();
        if terminal.agent_name != agent_name {
            return Err(TerminalError::AgentMismatch(id.to_string(), agent_name.to_string()));
        }

        terminal.write(data)
    }

    /// 停止终端
    pub fn stop(&self, id: &str, agent_name: &str) -> TerminalResult<()> {
        let entry = self
            .terminals
            .get(id)
            .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;

        let mut terminal = entry.lock().unwrap();
        if terminal.agent_name != agent_name {
            return Err(TerminalError::AgentMismatch(id.to_string(), agent_name.to_string()));
        }

        terminal.kill()?;
        self.persist_all();
        Ok(())
    }

    /// 获取终端日志
    pub fn logs(&self, id: &str, agent_name: &str, lines: usize) -> TerminalResult<String> {
        let entry = self
            .terminals
            .get(id)
            .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;

        let mut terminal = entry.lock().unwrap();
        if terminal.agent_name != agent_name {
            return Err(TerminalError::AgentMismatch(id.to_string(), agent_name.to_string()));
        }

        terminal.touch_viewed();
        let output = terminal.tail(lines);
        self.persist_all();
        Ok(output)
    }

    /// 列出终端（按 agent 过滤）
    pub fn list(&self, agent_name: Option<&str>) -> Vec<TerminalInfo> {
        self.terminals
            .iter()
            .filter(|entry| {
                let terminal = entry.value().lock().unwrap();
                agent_name.map_or(true, |name| terminal.agent_name == name)
            })
            .map(|entry| {
                let terminal = entry.value().lock().unwrap();
                TerminalInfo {
                    id: terminal.id.clone(),
                    agent_name: terminal.agent_name.clone(),
                    command: terminal.command.clone(),
                    description: terminal.description.clone(),
                    state: terminal.state.to_string(),
                    exit_code: terminal.exit_code,
                    cwd: terminal.cwd.clone(),
                    created_at: terminal.created_at.clone(),
                    updated_at: terminal.updated_at.clone(),
                    last_viewed_at: terminal.last_viewed_at.clone(),
                }
            })
            .collect()
    }

    /// 删除终端
    pub fn remove(&self, id: &str, agent_name: &str) -> TerminalResult<()> {
        let entry = self
            .terminals
            .get(id)
            .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;

        {
            let terminal = entry.lock().unwrap();
            if terminal.agent_name != agent_name {
                return Err(TerminalError::AgentMismatch(id.to_string(), agent_name.to_string()));
            }
            if terminal.is_running() {
                return Err(TerminalError::AlreadyRunning(format!(
                    "终端 {} 正在运行，请先 stop",
                    id
                )));
            }
        }
        drop(entry);

        self.terminals.remove(id);
        self.persist_all();
        Ok(())
    }

    /// 清理某 agent 的所有终端
    pub fn cleanup_agent(&self, agent_name: &str) {
        let ids_to_remove: Vec<String> = self
            .terminals
            .iter()
            .filter(|entry| {
                let terminal = entry.value().lock().unwrap();
                terminal.agent_name == agent_name
            })
            .map(|entry| entry.key().clone())
            .collect();

        for id in ids_to_remove {
            if let Some(entry) = self.terminals.get(&id) {
                let mut terminal = entry.lock().unwrap();
                let _ = terminal.kill();
            }
            self.terminals.remove(&id);
        }
        self.persist_all();
    }

    /// 关闭所有终端
    pub fn shutdown(&self) {
        for entry in self.terminals.iter() {
            let mut terminal = entry.value().lock().unwrap();
            let _ = terminal.kill();
        }
        self.terminals.clear();
        self.persist_all();
    }

    /// 更新命令过滤器配置
    pub fn set_filter(&self, config: crate::filter::FilterConfig) {
        let mut filter = self.filter.write().unwrap();
        filter.update_config(config);
    }

    /// 从文件加载过滤器配置
    pub fn load_filter_from_file(&self, path: &str) -> Result<(), String> {
        let mut filter = self.filter.write().unwrap();
        filter.load_from_file(path)
    }

    /// 更新沙箱配置
    pub fn set_sandbox(&self, config: crate::sandbox::SandboxConfig) {
        let mut sandbox = self.sandbox.write().unwrap();
        sandbox.update_config(config);
    }

    /// 获取终端数量
    pub fn count(&self) -> usize {
        self.terminals.len()
    }

    /// 检查终端是否存在
    pub fn exists(&self, id: &str) -> bool {
        self.terminals.contains_key(id)
    }

    /// 获取终端引用（内部使用，给 lib.rs 调用）
    pub fn get_terminal(
        &self,
        id: &str,
    ) -> Option<Arc<std::sync::Mutex<Terminal>>> {
        self.terminals
            .get(id)
            .map(|entry| entry.value().clone())
    }

    /// 生成状态面板文本
    pub fn status_panel(&self, agent_name: &str) -> String {
        let terminals: Vec<TerminalInfo> = self.list(Some(agent_name));
        if terminals.is_empty() {
            return format!("📋 Agent {} 当前没有终端", agent_name);
        }

        let mut lines = vec![
            format!("📋 Agent {} 的终端列表 (共 {} 个)", agent_name, terminals.len()),
            "| ID | 描述 | 状态 | 退出码 | 创建时间 |".to_string(),
            "|------|------|------|--------|----------|".to_string(),
        ];

        for t in &terminals {
            let emoji = match t.state.as_str() {
                "running" => "🟢",
                "exited" => "💤",
                "interrupted" => "⚠️",
                "killed" => "🔴",
                _ => "❓",
            };
            let exit_code = t
                .exit_code
                .map(|c| c.to_string())
                .unwrap_or_else(|| "—".to_string());
            lines.push(format!(
                "| {} | {} | {} {} | {} | {} |",
                t.id, t.description, emoji, t.state, exit_code, t.created_at
            ));
        }

        lines.join("\n")
    }

    /// 持久化所有终端
    fn persist_all(&self) {
        let entries: Vec<PersistedTerminal> = self
            .terminals
            .iter()
            .map(|entry| {
                let terminal = entry.value().lock().unwrap();
                terminal.to_persisted()
            })
            .collect();

        let p = self.persistence.read().unwrap();
        let _ = p.save(&entries);
    }
}

impl Default for TerminalRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// 终端信息（返回给 JS 侧）
#[derive(Debug, Clone, serde::Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub agent_name: String,
    pub command: String,
    pub description: String,
    pub state: String,
    pub exit_code: Option<i32>,
    pub cwd: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_viewed_at: Option<String>,
}
