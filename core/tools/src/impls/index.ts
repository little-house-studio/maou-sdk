/**
 * Built-in tool barrel exports and registration
 * Tools are organized by category: core/tools/{category}/{tool}/tool.ts
 */

import type { ToolRegistry } from "../registry.js";
import { TerminalTool } from "../terminal/use_terminal/tool.js";
import { ReadTool } from "../reader/god_tool/reader/tool.js";
import { WriteFileTool } from "../file/write_file/tool.js";
import { EditFileTool } from "../file/edit_file/tool.js";
import { UndoEditTool } from "../file/undo_edit/tool.js";
import { GlobTool } from "../search/glob/tool.js";
import { GrepTool } from "../search/grep/tool.js";
import { CodeSearchTool } from "../code/find_code/tool.js";
import { LspTool } from "../code/lsp/tool.js";
import { InternetSearchTool } from "../internet/search_internet/tool.js";
import { BrowserTool } from "../browser/god_tool/use_browser/tool.js";
import { BoardTool } from "../info/board/tool.js";
import { NotebookTool } from "../notes/notebook/tool.js";
import { LoadSkillTool } from "../skill/use_skill/tool.js";
import { FindSkillTool } from "../skill/find_skill/tool.js";
import { CreateSkillTool } from "../skill/create_skill/tool.js";
import { SubagentTool } from "../agent_team/agent_message/tool.js";
import { TeamManageTool } from "../agent_team/agent_manage/tool.js";
import { SupervisorTaskControlTool } from "../agent_team/supervisor_task_control/tool.js";
import { SupervisorChatMainTool } from "../agent_team/supervisor_chat_main/tool.js";
import { ProjectManageTool } from "../project/project_manage/tool.js";
import { TaskManageTool } from "../task/task_manage/tool.js";
import { TaskFinishTool } from "../task/task_finish/tool.js";
import { LlmJudgeTool } from "../llm_judge/tool.js";
import { YieldTool } from "../yield/tool.js";

export { TerminalTool } from "../terminal/use_terminal/tool.js";
export { ReadTool } from "../reader/god_tool/reader/tool.js";
export { WriteFileTool } from "../file/write_file/tool.js";
export { EditFileTool } from "../file/edit_file/tool.js";
export { UndoEditTool } from "../file/undo_edit/tool.js";
export { GlobTool } from "../search/glob/tool.js";
export { GrepTool } from "../search/grep/tool.js";
export { CodeSearchTool } from "../code/find_code/tool.js";
export { LspTool } from "../code/lsp/tool.js";
export { InternetSearchTool } from "../internet/search_internet/tool.js";
export { BrowserTool } from "../browser/god_tool/use_browser/tool.js";
export { BoardTool } from "../info/board/tool.js";
export { NotebookTool } from "../notes/notebook/tool.js";
export { LoadSkillTool } from "../skill/use_skill/tool.js";
export { FindSkillTool } from "../skill/find_skill/tool.js";
export { CreateSkillTool } from "../skill/create_skill/tool.js";
export { SubagentTool } from "../agent_team/agent_message/tool.js";
export { SubagentDelegateTool, createSubagentDelegateTool } from "../agent_team/subagent_delegate/tool.js";
export { TeamManageTool } from "../agent_team/agent_manage/tool.js";
export { SupervisorTaskControlTool } from "../agent_team/supervisor_task_control/tool.js";
export { SupervisorChatMainTool } from "../agent_team/supervisor_chat_main/tool.js";
export { ProjectManageTool } from "../project/project_manage/tool.js";
export { TaskManageTool } from "../task/task_manage/tool.js";
export { TaskFinishTool } from "../task/task_finish/tool.js";
export { LlmJudgeTool } from "../llm_judge/tool.js";
export { YieldTool } from "../yield/tool.js";

/**
 * Register all built-in tools
 */
export function registerBuiltins(registry: ToolRegistry): void {
  // Read-only / query tools - plan + execute modes
  registry.register(new ReadTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  registry.register(new CodeSearchTool());
  registry.register(new LspTool());
  registry.register(new InternetSearchTool());
  registry.register(new LoadSkillTool());
  registry.register(new FindSkillTool());
  registry.register(new CreateSkillTool());

  // Write / execute tools - execute mode only
  registry.register(new TerminalTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new UndoEditTool());
  registry.register(new BrowserTool());
  registry.register(new BoardTool());
  registry.register(new NotebookTool());
  registry.register(new SubagentTool());
  registry.register(new TeamManageTool());
  registry.register(new SupervisorTaskControlTool());
  registry.register(new SupervisorChatMainTool());
  registry.register(new ProjectManageTool());
  registry.register(new TaskManageTool());
  registry.register(new TaskFinishTool());

  // LLM 调用工具 - execute mode only
  // llm_judge：让 agent 在循环中调辅助 LLM 做判断（安全检查/代码审查/路由判定等）
  // 不加入任何默认白名单：agent 模板自行决定是否启用（PERMISSION.jsonc 或 agent.json tools）
  registry.register(new LlmJudgeTool());

  // 子 Agent 结果提交工具（P2-1）—— 不进任何默认白名单：
  // 仅在子 Agent 上下文（ToolContext.yieldResult 由 fork 注入）时可用。
  // 主 Agent 调用会返回"未启用"提示。agent 模板自行决定是否启用。
  registry.register(new YieldTool());

  // 子 Agent 委托工具（文件即子 Agent 约定）—— 不在此静态注册。
  // 真正的工具实例由 AgentRuntime 在工具初始化阶段通过 createSubagentDelegateTool()
  // 动态创建并注册为 subagent_<name>（依据 SubagentRegistry 扫描 agents/<name>/subagents/ 的结果）。
  // 若此处注册静态占位，会让 LLM 在无子 Agent 时也看到无意义的工具名，故不注册。
  // createSubagentDelegateTool 已导出，runtime 直接调用即可。
}
