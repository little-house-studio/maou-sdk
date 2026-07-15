/**
 * CommandPalette —— Ctrl+K 命令面板（交互式选择）。
 */

import React from "react";
import { Overlay } from "./Overlay.js";
import { SelectList, type SelectItem } from "./SelectList.js";

const COMMANDS: SelectItem[] = [
  { value: "new", label: "新对话", description: "清屏 · 画廊 · /new" },
  { value: "model", label: "选择模型", description: "Ctrl+M" },
  { value: "sessions", label: "切换会话", description: "历史会话" },
  { value: "prompt", label: "Request Preview", description: "/prompt 调试 system·bake·tools·before_user（不进上下文）" },
  { value: "settings", label: "设置", description: "Ctrl+," },
  { value: "agents", label: "Agent 管理", description: "空输入框 ←" },
  { value: "help", label: "帮助", description: "快捷键" },
  { value: "screenshot", label: "整屏截图", description: "Ctrl+G · /screenshot" },
  { value: "thinking", label: "切换思考级别", description: "设置里改" },
  { value: "quit", label: "退出", description: "Ctrl+C" },
];

export function CommandPalette({ onRun }: { onRun: (id: string) => void }) {
  return (
    <Overlay title="命令" footer="↑↓ 选择 · Enter 执行 · Esc 关闭" width={48}>
      <SelectList items={COMMANDS} onSelect={onRun} innerWidth={48} />
    </Overlay>
  );
}
