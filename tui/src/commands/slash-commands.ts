// ── 斜杠命令 ──────────────────────────────────────────────────────────
//
// 这是命令的单一真源——autocomplete 和 onSubmit 都从这里读。
// handleSlashCommand 接收 App 引用以调 driver/exit/state。

import type { SlashCommand } from "@oh-my-pi/pi-tui";
import type { App } from "../app.js";

/** 斜杠命令（Pi autocomplete 用，执行逻辑在 Editor.onSubmit）。 */
export const slashCommands: SlashCommand[] = [
  { name: "new", description: "新建会话" },
  { name: "quit", description: "退出会话" },
  { name: "exit", description: "退出会话", aliases: ["q"] },
  { name: "help", description: "显示所有命令", aliases: ["?"] },
  { name: "clear", description: "清空对话（同 /new）" },
  { name: "tools", description: "显示当前 agent 的工具列表" },
  { name: "model", description: "切换模型" },
  { name: "compact", description: "手动压缩上下文" },
  { name: "history", description: "搜索输入历史" },
  { name: "expand", description: "展开所有工具卡片", aliases: ["e"] },
  { name: "collapse", description: "折叠所有工具卡片", aliases: ["c"] },
  { name: "settings", description: "打开设置菜单（审批模式等）", aliases: ["s"] },
];

/** 处理斜杠命令，返回 true 表示已处理。 */
export function handleSlashCommand(cmd: string, app: App): boolean {
  switch (cmd) {
    case "quit": case "exit": case "q":
      app.requestExit();
      return true;
    case "new": case "clear":
      app.getDriver().clearMessages();
      app.getEditor().setText("");
      app.clearMdCache();
      return true;
    case "help": case "?": {
      const lines = slashCommands.map(c => `/${c.name}${c.aliases ? ` (${c.aliases.map(a => "/" + a).join(",")})` : ""} — ${c.description}`);
      app.getDriver().toast(lines.join(" | ").slice(0, 80), "info");
      return true;
    }
    case "tools": {
      const tools = app.getDriver().getToolWhitelist();
      app.getDriver().toast(`工具: ${tools.join(", ")}`.slice(0, 80), "info");
      return true;
    }
    case "expand": case "e":
      app.setToolsExpanded(true);
      return true;
    case "collapse": case "c":
      app.setToolsExpanded(false);
      return true;
    case "settings": case "s":
      app.getDriver().showSettings();
      return true;
    case "model":
    case "compact":
    case "history":
      app.getDriver().toast(`/${cmd} 暂未实现，敬请期待`, "warn");
      return true;
    default:
      return false; // 未知命令，当普通消息发给 agent
  }
}
