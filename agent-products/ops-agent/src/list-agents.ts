/**
 * Ops Agent 列表 —— 权威实现在 @little-house-studio/agent（core/agent）。
 *
 * 产品模型：system=ops 管家；project=各项目 coding。
 * 附属（proactive 等）与 coding 血统不得升格为 system 自由人。
 */

export {
  listOpsAgents,
  parseAgentSwitchId,
} from "@little-house-studio/agent";
export type {
  OpsAgentListEntry,
  ListOpsAgentsOptions,
} from "@little-house-studio/agent";
