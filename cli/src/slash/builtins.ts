/**
 * 内置 CLI 指令配置表 —— 每条一份 CliCommandSpec。
 * 启动时 registerBuiltinCliCommands() 写入 registry。
 */

import type { CliCommandSpec } from "./types.js";
import { cliCommands } from "./registry.js";

/** 静态内置配置（结构体数组，单一真相源） */
export const BUILTIN_CLI_COMMANDS: readonly CliCommandSpec[] = [
  // ── session ──
  {
    id: "new",
    name: "new",
    label: "新对话",
    description: "清屏 · 画廊 · 新会话",
    hotkey: "Ctrl+N",
    hotkeyKey: "ctrl+n",
    scope: "both",
    category: "session",
    palette: true,
    local: { kind: "action", action: "new_session" },
  },
  {
    id: "clear",
    name: "clear",
    label: "清空会话",
    description: "清空当前会话消息",
    scope: "both",
    category: "session",
    palette: false,
    local: { kind: "action", action: "clear_session" },
  },
  {
    id: "sessions",
    name: "sessions",
    label: "切换会话",
    description: "历史会话",
    scope: "local",
    category: "session",
    palette: true,
    local: { kind: "overlay", overlay: "sessions" },
  },
  // ── ui · model ──
  {
    id: "model",
    name: "model",
    aliases: ["select"],
    label: "选择模型",
    description: "切换 provider/model，或打开列表",
    usage: "[<provider> <model>]",
    hotkey: "Ctrl+M",
    hotkeyKey: "ctrl+m",
    scope: "local",
    category: "ui",
    palette: true,
    args: [
      { name: "provider", description: "API preset / provider id", required: false },
      { name: "model", description: "模型 id", required: false, rest: true },
    ],
    local: { kind: "action", action: "switch_model" },
  },
  {
    id: "settings",
    name: "settings",
    label: "设置",
    description: "Debug/主题/审核/模型…",
    hotkey: "Ctrl+,",
    hotkeyKey: "ctrl+,",
    scope: "local",
    category: "ui",
    palette: true,
    local: { kind: "overlay", overlay: "settings" },
  },
  {
    id: "theme",
    name: "theme",
    label: "配色方案",
    description: "切换主题（持久化）",
    scope: "local",
    category: "ui",
    palette: true,
    local: { kind: "overlay", overlay: "theme" },
  },
  {
    id: "agents",
    name: "agents",
    label: "Agent 管理",
    description: "空输入框 ←",
    scope: "local",
    category: "agent",
    palette: true,
    local: { kind: "overlay", overlay: "agents" },
  },
  {
    id: "help",
    name: "help",
    label: "帮助",
    description: "快捷键与指令",
    scope: "local",
    category: "ui",
    palette: true,
    local: { kind: "overlay", overlay: "help" },
  },
  {
    id: "thinking",
    name: "thinking",
    label: "切换思考级别",
    description: "循环 0–5",
    scope: "local",
    category: "ui",
    palette: true,
    local: { kind: "action", action: "thinking_cycle" },
  },
  {
    id: "screenshot",
    name: "screenshot",
    aliases: ["dump"],
    label: "整屏截图",
    description: "显存→剪贴板",
    hotkey: "Ctrl+G",
    hotkeyKey: "ctrl+g",
    scope: "local",
    category: "ui",
    palette: true,
    local: { kind: "action", action: "screenshot" },
  },
  {
    id: "prompt",
    name: "prompt",
    label: "Request Preview",
    description: "调试 system/bake/tools/before_user（不进上下文）",
    scope: "local",
    category: "debug",
    palette: true,
    local: { kind: "overlay", overlay: "prompt" },
  },
  {
    id: "quit",
    name: "quit",
    label: "退出",
    description: "退出 CLI",
    hotkey: "Ctrl+C",
    // Ctrl+C 走取消栈，不经热键表；仅帮助展示
    scope: "local",
    category: "system",
    palette: true,
    local: { kind: "action", action: "quit" },
  },
  // ── runtime fallbacks（agent commandRegistry 未就绪时补全仍可用）──
  {
    id: "goal",
    name: "goal",
    label: "监督模式",
    description: "启动监督模式",
    usage: "[任务描述]",
    scope: "runtime",
    category: "agent",
    palette: false,
    args: [{ name: "task", description: "任务描述", rest: true }],
  },
  {
    id: "stop",
    name: "stop",
    label: "停止生成",
    description: "停止当前生成",
    scope: "runtime",
    category: "session",
    palette: false,
    local: { kind: "action", action: "stop" },
  },
  {
    id: "agent",
    name: "agent",
    label: "切换 agent",
    description: "切换 agent",
    usage: "<name>",
    scope: "runtime",
    category: "agent",
    palette: false,
    args: [{ name: "name", required: true }],
  },
  {
    id: "compact",
    name: "compact",
    label: "压缩上下文",
    description: "强制压缩上下文",
    scope: "runtime",
    category: "session",
    palette: false,
  },
  {
    id: "usage",
    name: "usage",
    aliases: ["cost"],
    label: "会话用量",
    description: "费用/时长/token",
    scope: "runtime",
    category: "session",
    palette: false,
  },
  {
    id: "context",
    name: "context",
    label: "上下文占用",
    description: "上下文占用与压缩阈值",
    scope: "runtime",
    category: "session",
    palette: false,
  },
  {
    id: "init",
    name: "init",
    label: "初始化项目说明",
    description: "扫描项目并写入 .maou/project/（USER/PROJECT/RULE/DESIGN/EXPERIENCE）",
    scope: "runtime",
    category: "session",
    palette: true,
  },
] as const satisfies readonly CliCommandSpec[];

let builtinsRegistered = false;

/** 幂等：注册全部内置指令 */
export function registerBuiltinCliCommands(): void {
  if (builtinsRegistered) return;
  cliCommands.registerAll(BUILTIN_CLI_COMMANDS);
  builtinsRegistered = true;
}

/** 测试用：重置内置注册标记并清空 builtin 源 */
export function resetBuiltinCliCommandsForTest(): void {
  cliCommands.unregisterBySource("builtin");
  // 兼容未标 source 的旧项：按 id 卸
  for (const s of BUILTIN_CLI_COMMANDS) {
    cliCommands.unregister(s.id);
  }
  builtinsRegistered = false;
}
