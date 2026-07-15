/**
 * MCP 工具暴露策略（Host → LLM tools 数组）。
 *
 * - flat：每个 MCP tool 一条 schema（mcp__server__tool）—— 小工具量默认
 * - gateway：仅注册一个元工具 `mcp`（list/search/schema/call）—— 大规模 / coding 默认
 */

/** 暴露给 LLM 的策略 */
export type McpToolExposureStrategy = "flat" | "gateway";

/** gateway 模式下注册的唯一工具名 */
export const MCP_GATEWAY_TOOL_NAME = "mcp";

/**
 * 解析 agent.json / RunOptions 中的策略字段。
 * 接受别名：meta/single → gateway；expand/all → flat。
 */
export function parseMcpToolExposureStrategy(
  raw: unknown,
  fallback: McpToolExposureStrategy = "flat",
): McpToolExposureStrategy {
  if (raw == null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase();
  if (s === "gateway" || s === "meta" || s === "single" || s === "one") {
    return "gateway";
  }
  if (s === "flat" || s === "expand" || s === "all" || s === "full") {
    return "flat";
  }
  return fallback;
}

/** 从 agent 配置对象读取（支持嵌套 mcp.tool_strategy） */
export function readMcpToolStrategyFromAgentConfig(
  agent: Record<string, unknown> | null | undefined,
  fallback: McpToolExposureStrategy = "flat",
): McpToolExposureStrategy {
  if (!agent) return fallback;
  if (agent.mcp_tool_strategy != null) {
    return parseMcpToolExposureStrategy(agent.mcp_tool_strategy, fallback);
  }
  const mcp = agent.mcp;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    const m = mcp as Record<string, unknown>;
    if (m.tool_strategy != null) {
      return parseMcpToolExposureStrategy(m.tool_strategy, fallback);
    }
    if (m.tools_mode != null) {
      return parseMcpToolExposureStrategy(m.tools_mode, fallback);
    }
  }
  return fallback;
}
