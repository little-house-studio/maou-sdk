import type { McpSessionStatus } from "./session.js";

export function formatMcpUnavailableMessage(opts: {
  connectionName: string;
  toolName?: string;
  status: McpSessionStatus | string;
  lastError?: string | null;
  reconnecting?: boolean;
}): string {
  const tool = opts.toolName ? `.${opts.toolName}` : "";
  const lines = [
    `MCP server 「${opts.connectionName}」${tool} 当前不可用。`,
    `状态: ${opts.status}`,
  ];
  if (opts.lastError) lines.push(`上次错误: ${opts.lastError}`);
  if (opts.reconnecting) {
    lines.push("正在后台重连，工具表仍保留；稍后再试同一调用。");
  } else {
    lines.push("工具表未卸。可稍后重试，或检查 MCP 配置后发下一条消息触发重载。");
  }
  return lines.join("\n");
}
