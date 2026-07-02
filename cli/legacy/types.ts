/**
 * AgentCliConfig —— agent cli 配置接口。
 *
 * cli 层（@little-house-studio/cli）是通用框架（90%+ 功能），
 * agent 通过实现此接口提供配置 + 后端对接（10%）。
 *
 * 用法：agent 写一个 cli 配置文件 `export default { ... } satisfies AgentCliConfig`，
 * 然后 `maou <path/to/file>` 加载它，启动通用 CLI 界面测试该 agent。
 */

import type { Runtime } from "@little-house-studio/agent";

export interface AgentHandle {
  /** 通用 Runtime 门面（驱动 agent 循环） */
  runtime: Runtime;
  /** 新建会话，返回 sessionId */
  startSession: (title?: string) => string;
}

export interface AgentCliConfig {
  /** agent 名称（显示用） */
  name: string;
  /**
   * 创建 agent 句柄（装配依赖 + 物化）。
   * @param projectRoot 绑定的项目根目录（cwd）
   * @param maouRoot ~/.maou 根目录
   */
  createAgent: (projectRoot: string, maouRoot: string) => AgentHandle;
  /** 取 preset（provider + model → APIPreset） */
  getPreset: (provider: string, model: string) => Record<string, unknown>;
  /** 列出可用 provider（给 ModelPicker 用，可选） */
  getProviders?: () => { id: string; name?: string }[];
  /** 列出 provider 下的 model（可选） */
  getModels?: (provider: string) => { id: string; name?: string }[];
}
