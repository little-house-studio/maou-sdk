/**
 * SessionDialog —— 会话记录选择。
 * 阶段 4 基础：从 SessionStore 读会话列表（如可用）；暂空则提示。
 * 阶段 7 加会话树导航（/tree）。
 */

import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { SelectList, type SelectItem } from "./SelectList.js";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { join } from "node:path";
import { readdirSync, readFileSync, existsSync } from "node:fs";

export function SessionDialog() {
  const t = useTheme();
  const { setSessionId, toastMsg, clearMessages } = useStore();
  const [items, setItems] = useState<SelectItem[]>([]);

  useEffect(() => {
    // 从 .maou/sessions 读会话列表
    const sessionsDir = join(process.cwd(), ".maou", "sessions");
    const out: SelectItem[] = [];
    if (existsSync(sessionsDir)) {
      try {
        const files = readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl"));
        for (const f of files.slice(0, 20)) {
          const id = f.replace(/\.jsonl$/, "");
          // 读首行取 title/时间
          try {
            const first = readFileSync(join(sessionsDir, f), "utf-8").split("\n")[0];
            const meta = JSON.parse(first);
            out.push({ value: id, label: id.slice(0, 12), description: meta?.title ?? meta?.createdAt ?? "" });
          } catch {
            out.push({ value: id, label: id.slice(0, 12) });
          }
        }
      } catch { /* ignore */ }
    }
    setItems(out);
  }, []);

  const onSelect = (value: string) => {
    setSessionId(value);
    clearMessages();
    toastMsg(`切换会话 ${value.slice(0, 8)}`, "ok");
    useStore.getState().setOverlay(null);
  };

  return (
    <Overlay title="会话" footer="↑↓ 选择 · Enter 切换 · Esc 关闭" width={50}>
      {items.length === 0 ? (
        <Text color={t.dim}>无历史会话（{join(process.cwd(), ".maou", "sessions")}）</Text>
      ) : (
        <SelectList items={items} onSelect={onSelect} />
      )}
    </Overlay>
  );
}
