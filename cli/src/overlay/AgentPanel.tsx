/**
 * AgentPanel —— agent 管理面板（Ctrl+, 不在此；空输入框按左键 / 命令面板进入）。
 * 列出所有 agent（main + 子agent，来自 config.listAgents），上下选择，Enter 切换。
 * → 键或 Esc 返回聊天（app.tsx 路由）。
 *
 * 切换语义：main agent → 重置为新会话（重建 handle）；子 agent → 提示由 main 调度。
 * 真正的跨 config 热切换需 createAgent 接受 name，暂不支持。
 */

import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { SelectList, type SelectItem } from "./SelectList.js";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import type { AgentCliConfig } from "../types.js";
import type { AgentEntry } from "@little-house-studio/agent";

export function AgentPanel({ config }: { config: AgentCliConfig }) {
  const t = useTheme();
  const [items, setItems] = useState<SelectItem[]>([]);

  useEffect(() => {
    const entries = config.listAgents?.() ?? [];
    // main agent（无 parent）排前，子 agent（有 parent）排后并缩进
    const main = entries.filter(e => !e.parent);
    const subs = entries.filter(e => !!e.parent);
    const out: SelectItem[] = [];
    for (const e of main) {
      out.push({ value: e.name, label: `▌ ${e.display_name || e.name}`, description: `${e.role || "agent"} · ${e.status || "idle"}` });
    }
    if (subs.length > 0) {
      out.push({ value: "__subs__", label: "── 子 agent ──", description: "" });
      for (const e of subs) {
        out.push({ value: `sub:${e.name}`, label: `  └ ${e.display_name || e.name}`, description: `${e.role || ""} · parent:${e.parent}` });
      }
    }
    setItems(out);
  }, [config]);

  const onSelect = (value: string) => {
    if (value === "__subs__") return;
    if (value.startsWith("sub:")) {
      useStore.getState().toastMsg("子 agent 由 main agent 调度，无法独立切换", "info");
      useStore.getState().setOverlay(null);
      return;
    }
    // main agent 切换：重置 handle + 新会话
    useStore.getState().requestAgentSwitch(value);
  };

  return (
    <Overlay title="Agent 管理" footer="↑↓ 选择 · Enter 切换/查看 · → / Esc 返回" width={56}>
      {items.length === 0 ? (
        <Text color={t.dim}>无可用 agent（~/.maou/agents 与 .maou/agents 均为空）</Text>
      ) : (
        <SelectList items={items} onSelect={onSelect} innerWidth={52} />
      )}
    </Overlay>
  );
}

// AgentEntry 仅用于类型推导 config.listAgents 返回，此处 import type 保证类型可见
export type { AgentEntry };
