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
import { CodeSearchTool } from "../code/find_code/tool.js";
import { InternetSearchTool } from "../internet/search_internet/tool.js";
import { BrowserTool } from "../browser/god_tool/use_browser/tool.js";
import { BoardTool } from "../info/board/tool.js";
import { NotebookTool } from "../notes/notebook/tool.js";
import { LoadSkillTool } from "../skill/use_skill/tool.js";
import { FindSkillTool } from "../skill/find_skill/tool.js";
import { CreateSkillTool } from "../skill/create_skill/tool.js";
import { SubagentTool } from "../agent_team/agent_message/tool.js";
import { TeamManageTool } from "../agent_team/agent_manage/tool.js";
import { ProjectManageTool } from "../project/project_manage/tool.js";
import { TaskManageTool } from "../task/task_manage/tool.js";
import { TaskFinishTool } from "../task/task_finish/tool.js";

export { TerminalTool } from "../terminal/use_terminal/tool.js";
export { ReadTool } from "../reader/god_tool/reader/tool.js";
export { WriteFileTool } from "../file/write_file/tool.js";
export { EditFileTool } from "../file/edit_file/tool.js";
export { GlobTool } from "../search/glob/tool.js";
export { GrepTool } from "../search/grep/tool.js";
export { CodeSearchTool } from "../code/find_code/tool.js";
export { InternetSearchTool } from "../internet/search_internet/tool.js";
export { BrowserTool } from "../browser/god_tool/use_browser/tool.js";
export { BoardTool } from "../info/board/tool.js";
export { NotebookTool } from "../notes/notebook/tool.js";
export { LoadSkillTool } from "../skill/use_skill/tool.js";
export { FindSkillTool } from "../skill/find_skill/tool.js";
export { CreateSkillTool } from "../skill/create_skill/tool.js";
export { SubagentTool } from "../agent_team/agent_message/tool.js";
export { TeamManageTool } from "../agent_team/agent_manage/tool.js";
export { ProjectManageTool } from "../project/project_manage/tool.js";
export { TaskManageTool } from "../task/task_manage/tool.js";
export { TaskFinishTool } from "../task/task_finish/tool.js";

/**
 * Register all built-in tools
 */
export function registerBuiltins(registry: ToolRegistry): void {
  // Read-only / query tools - plan + execute modes
  registry.register(new ReadTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  registry.register(new CodeSearchTool());
  registry.register(new InternetSearchTool());
  registry.register(new LoadSkillTool());
  registry.register(new FindSkillTool());
  registry.register(new CreateSkillTool());

  // Write / execute tools - execute mode only
  registry.register(new TerminalTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new BrowserTool());
  registry.register(new BoardTool());
  registry.register(new NotebookTool());
  registry.register(new SubagentTool());
  registry.register(new TeamManageTool());
  registry.register(new ProjectManageTool());
  registry.register(new TaskManageTool());
  registry.register(new TaskFinishTool());
}
