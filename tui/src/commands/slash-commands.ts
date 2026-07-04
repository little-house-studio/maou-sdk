// ── 斜杠命令 ──────────────────────────────────────────────────────────
//
// 命令来源：
//   1. TUI 内置命令（quit/exit/expand/collapse/settings/tools）—— TUI 层处理
//   2. Agent 层命令（new/clear/stop/agent/help/goal）—— runtime commandRegistry 处理
// 两者合并生成 autocomplete 列表。handleSlashCommand 先查 TUI 内置，再交给 agent 层。

import type { SlashCommand } from "@oh-my-pi/pi-tui";
import type { App } from "../app.js";

/** TUI 内置命令（TUI 层处理，不交给 agent） */
const tuiCommands: SlashCommand[] = [
  { name: "quit", description: "退出会话" },
  { name: "exit", description: "退出会话", aliases: ["q"] },
  { name: "expand", description: "展开所有工具卡片", aliases: ["e"] },
  { name: "collapse", description: "折叠所有工具卡片", aliases: ["c"] },
  { name: "settings", description: "打开设置菜单（审批模式等）", aliases: ["s"] },
  { name: "tools", description: "显示当前 agent 的工具列表" },
];

/** Agent 层命令的 fallback 描述（当 runtime 未物化时用） */
const agentCommandFallback: SlashCommand[] = [
  { name: "new", description: "新建会话" },
  { name: "clear", description: "清空对话" },
  { name: "stop", description: "停止当前任务" },
  { name: "agent", description: "切换/管理 Agent" },
  { name: "help", description: "显示所有命令", aliases: ["?"] },
  { name: "goal", description: "启动监督模式" },
];

/** 动态获取所有命令（TUI 内置 + agent 层）。agent 物化后从 commandRegistry 拉取。 */
export function getSlashCommands(app: App): SlashCommand[] {
  const driver = app.getDriver();
  // 尝试从 agent runtime 拉取命令列表
  const agentCmds = driver.getAgentCommands();
  if (agentCmds.length > 0) {
    return [...tuiCommands, ...agentCmds];
  }
  // agent 未物化时用 fallback
  return [...tuiCommands, ...agentCommandFallback];
}

/** 静态命令列表（初始化时用，agent 物化后会动态更新） */
export const slashCommands: SlashCommand[] = [...tuiCommands, ...agentCommandFallback];

/** 处理斜杠命令，返回 true 表示已处理。 */
export function handleSlashCommand(cmd: string, app: App): boolean {
  // 先查 TUI 内置命令
  switch (cmd) {
    case "quit": case "exit": case "q":
      app.requestExit();
      return true;
    case "expand": case "e":
      app.setToolsExpanded(true);
      return true;
    case "collapse": case "c":
      app.setToolsExpanded(false);
      return true;
    case "settings": case "s":
      app.getDriver().showSettings();
      return true;
    case "tools": {
      const tools = app.getDriver().getToolWhitelist();
      app.getDriver().toast(`工具: ${tools.join(", ")}`.slice(0, 80), "info");
      return true;
    }
  }
  // 未知 TUI 命令 → 交给 agent 层 runtime commandRegistry 处理
  // runtime 会在 run() 里自动检测 /xxx 命令并执行
  // 如果 agent 层也不认识，会当普通消息发给 LLM
  return false;
}
