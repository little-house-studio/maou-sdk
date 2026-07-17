/**
 * CommandPalette —— Ctrl+K 命令面板（交互式选择）。
 * 条目来自 config/cli-commands 统一注册表。
 */

import React from "react";
import { Overlay } from "./Overlay.js";
import { SelectList, type SelectItem } from "./SelectList.js";
import { commandPaletteItems } from "../config/cli-commands.js";

export function CommandPalette({ onRun }: { onRun: (id: string) => void }) {
  const items: SelectItem[] = commandPaletteItems();
  return (
    <Overlay title="命令" footer="↑↓ 选择 · Enter 执行 · Esc 关闭" width={48}>
      <SelectList items={items} onSelect={onRun} innerWidth={48} />
    </Overlay>
  );
}
