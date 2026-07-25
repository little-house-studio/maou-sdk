/** Ops Agent 的稳定名称、轮次与工具能力边界。 */

export const OPS_TOOL_WHITELIST = [
  "reader",
  "write_file",
  "edit_file",
  "undo_edit",
  "glob",
  "grep",
  "use_terminal",
  "search_internet",
  "use_browser",
  "board",
  "notebook",
  "use_skill",
  "find_skill",
  "create_skill",
  "todo_manage",
  "todo_finish",
  "agent_message",
  "agent_manage",
  "project_agent",
  "change_self",
  "llm_judge",
  "yield",
  "mcp",
] as const;

export const DEFAULT_OPS_AGENT_NAME = "ops";
export const DEFAULT_OPS_ROUND_LIMIT = 80;
