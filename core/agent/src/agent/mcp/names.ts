/**
 * MCP 工具命名空间约定。
 *
 * 格式：`mcp__<connection>__<tool>`
 * - connection / tool 段经 sanitize，仅保留 [A-Za-z0-9_-]
 * - 解析时以第一个 `__`（去掉 `mcp__` 前缀后）分隔 connection 与 original tool 名
 *
 * 多 server 时避免工具名碰撞；与 mcp-proxy / subagent 继承约定一致。
 */

/** MCP 工具名前缀 */
export const MCP_TOOL_PREFIX = "mcp__";

/**
 * 将任意连接/工具名规范为安全段（LLM tool name 友好）。
 */
export function sanitizeMcpSegment(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "unnamed";
}

/**
 * 构造 namespaced 工具名：`mcp__<conn>__<tool>`
 */
export function namespacedMcpToolName(connectionName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${sanitizeMcpSegment(connectionName)}__${sanitizeMcpSegment(toolName)}`;
}

/**
 * 是否为 MCP namespaced 工具名
 */
export function isNamespacedMcpToolName(name: string): boolean {
  return typeof name === "string" && name.startsWith(MCP_TOOL_PREFIX);
}

/**
 * 解析 namespaced 工具名。
 * @returns connectionName + originalName（sanitize 后的段），失败返回 null
 */
export function parseNamespacedMcpToolName(
  name: string,
): { connectionName: string; originalName: string } | null {
  if (!isNamespacedMcpToolName(name)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const idx = rest.indexOf("__");
  if (idx <= 0 || idx >= rest.length - 1) return null;
  return {
    connectionName: rest.slice(0, idx),
    originalName: rest.slice(idx + 2),
  };
}
