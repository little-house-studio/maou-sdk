/** 安装员的稳定名称、轮次与工具能力边界。 */

export const INSTALL_TOOL_WHITELIST = [
  "use_terminal",
  "terminal/*",
  "search_internet",
  "web_fetch",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "todo/*",
] as const;

export const DEFAULT_INSTALL_AGENT_NAME = "install";
export const DEFAULT_INSTALL_ROUND_LIMIT = 80;
