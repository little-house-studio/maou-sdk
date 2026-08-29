/**
 * Built-in tool barrel exports and registration
 * Tools are organized by category: core/tools/{category}/{tool}/tool.ts
 */

import type { ToolRegistry } from "../registry.js";
import { TerminalTool } from "../terminal/use_terminal/tool.js";
import { ReadTool } from "../reader/god_tool/reader/tool.js";
import { WriteFileTool } from "../file/write_file/tool.js";
import { EditFileTool } from "../file/edit_file/tool.js";
import { GlobTool } from "../search/glob/tool.js";
import { GrepTool } from "../search/grep/tool.js";
import { CodeSearchTool } from "../sqry/find_code/tool.js";
import { LspTool } from "../lsp/lsp/tool.js";
import { InternetSearchTool } from "../internet/search_internet/tool.js";
import { BrowserTool } from "../browser/god_tool/use_browser/tool.js";
import { BoardTool } from "../board/board/tool.js";
import { LoadSkillTool } from "../skill/use_skill/tool.js";
import { FindSkillTool } from "../skill/find_skill/tool.js";
import { CreateSkillTool } from "../skill/create_skill/tool.js";
import { SkillGodTool } from "../skill/god_tool/skill/tool.js";
import { SubagentTool } from "../agent_team/agent_message/tool.js";
import { TeamManageTool } from "../agent_team/agent_manage/tool.js";
import { AgentSendTool } from "../agent_team/agent_send/tool.js";
import { AgentTeamGodTool } from "../agent_team/god_tool/agent_team/tool.js";
import { ProjectManageTool } from "../project/project_manage/tool.js";
import { ProjectAgentTool } from "../project/project_agent/tool.js";
import { ProjectSendTool } from "../project/project_send/tool.js";
import { ProjectGodTool } from "../project/god_tool/project/tool.js";
import { ChangeSelfTool } from "../agent_team/change_self/tool.js";
import { TodoManageTool } from "../todo/task_manage/tool.js";
import { TodoFinishTool } from "../todo/task_finish/tool.js";
import { YieldTool } from "../yield/tool.js";
import { ReportToParentTool } from "../agent_team/report_to_parent/tool.js";
import { AskUserTool } from "../ask_user/tool.js";
import { GetGoalTool } from "../goal/get_goal/tool.js";
import { CreateGoalTool } from "../goal/create_goal/tool.js";
import { UpdateGoalTool } from "../goal/update_goal/tool.js";
import { SubmitPlanTool } from "../plan/submit_plan/tool.js";
import { ReadFileTool } from "../reader/read_file/tool.js";
import { ReadImageTool } from "../reader/read_image/tool.js";
import { WebFetchTool } from "../reader/web_fetch/tool.js";
import { bindDomainVerbs } from "../split/verbs.js";

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
export { GlobTool } from "../search/glob/tool.js";
export { GrepTool } from "../search/grep/tool.js";
export { CodeSearchTool } from "../sqry/find_code/tool.js";
export { LspTool } from "../lsp/lsp/tool.js";
export { InternetSearchTool } from "../internet/search_internet/tool.js";
export { BrowserTool } from "../browser/god_tool/use_browser/tool.js";
export { BoardTool } from "../board/board/tool.js";
export { LoadSkillTool } from "../skill/use_skill/tool.js";
export { FindSkillTool } from "../skill/find_skill/tool.js";
export { CreateSkillTool } from "../skill/create_skill/tool.js";
export { SkillGodTool } from "../skill/god_tool/skill/tool.js";
export { SubagentTool } from "../agent_team/agent_message/tool.js";
export { SubagentDelegateTool, createSubagentDelegateTool } from "../agent_team/subagent_delegate/tool.js";
export { TeamManageTool } from "../agent_team/agent_manage/tool.js";
export { AgentSendTool } from "../agent_team/agent_send/tool.js";
export { AgentTeamGodTool } from "../agent_team/god_tool/agent_team/tool.js";
export { ProjectManageTool } from "../project/project_manage/tool.js";
export { ProjectAgentTool } from "../project/project_agent/tool.js";
export { ProjectSendTool } from "../project/project_send/tool.js";
export { ProjectGodTool } from "../project/god_tool/project/tool.js";
export { ChangeSelfTool } from "../agent_team/change_self/tool.js";
export { TodoManageTool, TaskManageTool } from "../todo/task_manage/tool.js";
export { TodoFinishTool, TaskFinishTool } from "../todo/task_finish/tool.js";
export { YieldTool } from "../yield/tool.js";
export { ReportToParentTool } from "../agent_team/report_to_parent/tool.js";
export { AskUserTool } from "../ask_user/tool.js";
export { bindAskUserHost, getAskUserHost } from "../ask_user/host.js";
export type { AskUserRequest, AskUserResult, AskUserHost } from "../ask_user/host.js";
export {
  bindReportWake,
  takeQuietReports,
  formatQuietReports,
  resetQuietReportsForTest,
} from "../agent_team/report_to_parent/host.js";
export { GetGoalTool } from "../goal/get_goal/tool.js";
export { CreateGoalTool } from "../goal/create_goal/tool.js";
export { UpdateGoalTool } from "../goal/update_goal/tool.js";
export { SubmitPlanTool } from "../plan/submit_plan/tool.js";
export { ReadFileTool } from "../reader/read_file/tool.js";
export { ReadImageTool } from "../reader/read_image/tool.js";
export { WebFetchTool } from "../reader/web_fetch/tool.js";

/**
 * Register all built-in tools
 */
export function registerBuiltins(registry: ToolRegistry): void {
  const reader = new ReadTool();
  const terminal = new TerminalTool();
  const findSkill = new FindSkillTool();
  const todoManage = new TodoManageTool();
  const board = new BoardTool();
  const findCode = new CodeSearchTool();
  const lsp = new LspTool();
  const browser = new BrowserTool();

  registry.register(reader);
  registry.register(new ReadFileTool());
  registry.register(new ReadImageTool());
  registry.register(new WebFetchTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  registry.register(findCode);
  registry.register(lsp);
  registry.register(new InternetSearchTool());
  registry.register(new LoadSkillTool());
  registry.register(findSkill);
  registry.register(new CreateSkillTool());
  registry.register(new SkillGodTool());

  registry.register(terminal);
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(browser);
  registry.register(board);
  registry.register(new SubagentTool());
  registry.register(new TeamManageTool());
  registry.register(new AgentSendTool());
  registry.register(new AgentTeamGodTool());
  registry.register(new ProjectManageTool());
  registry.register(new ProjectAgentTool());
  registry.register(new ProjectSendTool());
  registry.register(new ProjectGodTool());
  registry.register(new ChangeSelfTool());
  registry.register(todoManage);
  registry.register(new TodoFinishTool());

  registry.register(new YieldTool());
  registry.register(new ReportToParentTool());
  registry.register(new AskUserTool());
  registry.register(new GetGoalTool());
  registry.register(new CreateGoalTool());
  registry.register(new UpdateGoalTool());
  registry.register(new SubmitPlanTool());

  for (const verb of bindDomainVerbs({
    terminal,
    findSkill,
    todo: todoManage,
    board,
    findCode,
    lsp,
    browser,
  })) {
    registry.register(verb);
  }
}
