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
import { TodoManageTool } from "../task/task_manage/tool.js";
import { TodoFinishTool } from "../task/task_finish/tool.js";
import { LlmJudgeTool } from "../llm_judge/tool.js";
import { YieldTool } from "../yield/tool.js";

export { TerminalTool } from "../terminal/use_terminal/tool.js";

// 操作安全统一入口
export {
  evaluateWithDcg,
  resolveDcgBinary,
  ensureDcgInstalled,
  formatDcgDenyMessage,
  setDcgEvaluatorForTest,
  checkMaouHardDeny,
  matchMaouSafeAllow,
  tryOverrideDcgDeny,
  assessCommandSecurity,
  gateTerminalCommand,
  mapDcgDenyToTier,
  checkLocalSecurityRules,
  listLocalSecurityRules,
} from "../security/index.js";
export type {
  SecurityTier,
  SecurityAssessment,
  SecurityGateResult,
  DcgEvalResult,
} from "../security/index.js";

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
export { TodoManageTool, TaskManageTool } from "../task/task_manage/tool.js";
export { TodoFinishTool, TaskFinishTool } from "../task/task_finish/tool.js";
export { LlmJudgeTool } from "../llm_judge/tool.js";
export { YieldTool } from "../yield/tool.js";

/**
 * Register all built-in tools
 */
export function registerBuiltins(registry: ToolRegistry): void {
  registry.register(new ReadTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  registry.register(new CodeSearchTool());
  registry.register(new LspTool());
  registry.register(new InternetSearchTool());
  registry.register(new LoadSkillTool());
  registry.register(new FindSkillTool());
  registry.register(new CreateSkillTool());

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
  registry.register(new TodoManageTool());
  registry.register(new TodoFinishTool());

  registry.register(new LlmJudgeTool());
  registry.register(new YieldTool());
}
