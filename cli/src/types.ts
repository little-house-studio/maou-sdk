/**
 * AgentCliConfig / AgentHandle —— 接入契约类型出口。
 *
 * 类型定义在 @little-house-studio/agent 层（避免 cli ↔ coding-agent 循环依赖），
 * 此文件仅作 re-export，保持 `@little-house-studio/cli/types` 的对外路径不变
 * （dist/types.d.ts 是 coding-agent 等消费方的 import 路径）。
 */

export type { AgentCliConfig, AgentHandle } from "@little-house-studio/agent";
