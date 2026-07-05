/**
 * AgentCliConfig —— agent cli 配置接口（接入契约）。
 *
 * 放在 agent 层（而非 cli 层）以避免 cli ↔ coding-agent 循环依赖：
 * cli 与 coding-agent 都从 @little-house-studio/agent 引用此类型，
 * 不再有 build 时类型依赖环。
 *
 * cli 层（@little-house-studio/cli）是通用框架（90%+ 功能），
 * agent 通过实现此接口提供配置 + 后端对接（10%）。
 *
 * 用法：agent 写一个 cli 配置文件 `export default { ... } satisfies AgentCliConfig`，
 * 然后 `maou <path/to/file>` 加载它，启动通用 CLI 界面测试该 agent。
 */

import type { AgentHandle } from "../agent/handle.js";
import type { AgentEntry } from "../agent/registry.js";

export interface AgentCliConfig {
  /** agent 名称（显示用，与 AgentHandle.agentName 互为校验） */
  name: string;
  /**
   * 创建 agent 句柄（装配依赖 + 物化）。
   * @param projectRoot 绑定的项目根目录（cwd）
   * @param maouRoot ~/.maou 根目录
   * 返回的 AgentHandle 应包含 agentName，供 cli 状态栏动态显示当前 agent 名。
   */
  createAgent: (projectRoot: string, maouRoot: string) => AgentHandle;
  /** 取 preset（provider + model → APIPreset，含 maxContext 真实上下文窗口） */
  getPreset: (provider: string, model: string) => Record<string, unknown>;
  /** 列出可用 provider（给 ModelDialog 用，可选） */
  getProviders?: () => { id: string; name?: string }[];
  /** 列出 provider 下的 model（可选） */
  getModels?: (provider: string) => { id: string; name?: string }[];
  /**
   * 列出所有 agent（main + 子agent），供 CLI 的 agent 管理面板使用（可选）。
   * 同步返回 AgentEntry 摘要（name/display_name/status/role/team/parent 等）。
   * 实现通常委托 AgentRegistry.list()。
   */
  listAgents?: () => AgentEntry[];
}
