/**
 * AgentHandle —— 通用「绑定项目的 Agent 句柄」接口。
 *
 * 任何场景特化 agent（coding / reviewer / security-auditor / ...）都返回此接口，
 * 调用方（CLI / harness / 测试）无需感知具体类型即可统一调用。
 *
 * 字段语义：
 *   - runtime：底层 Runtime 门面实例（已装配好压缩闭环 / 工具注册表 / llmClient）
 *   - agentName：物化在 ~/.maou/agents/<name>/ 的 agent 名
 *   - projectRoot：绑定的项目目录
 *   - toolWhitelist：传给 LLM 的工具白名单（PERMISSION.jsonc 同步）
 *   - startSession(title?)：通用会话启动（已封装 task_plan 恢复）
 */

import type { Runtime } from "./runtime-facade.js";

export interface AgentHandle {
  /** 已装配好的 Runtime 门面实例。 */
  runtime: Runtime;
  /** 物化在 ~/.maou/agents/<name>/ 的 agent 名。 */
  agentName: string;
  /** 绑定的项目根目录。 */
  projectRoot: string;
  /** 工具白名单（写入 PERMISSION.jsonc.tool_whitelist + agent.json.tools）。 */
  toolWhitelist: readonly string[];
  /**
   * 启动新会话。
   * 内部调用 runtime.startSession(agentName, title)，
   * 已封装从 task_plan.json 恢复未完成 todo 到 TaskManager 内存。
   */
  startSession(title?: string): string;
}
