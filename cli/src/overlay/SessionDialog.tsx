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
import { loadSessionMessages } from "../state/session-loader.js";
import { join } from "node:path";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { projectSessionsDir } from "../config/paths.js";

export function SessionDialog() {
  const t = useTheme();
  const { setSessionId } = useStore();
  const [items, setItems] = useState<SelectItem[]>([]);

  useEffect(() => {
    // 从项目 .maou/sessions 读会话列表（最新在前）
    const sessionsDir = projectSessionsDir();
    const out: SelectItem[] = [];
    if (existsSync(sessionsDir)) {
      try {
        const files = readdirSync(sessionsDir)
          .filter(f => f.endsWith(".jsonl"))
          .map(f => ({ f, mtime: statSync(join(sessionsDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 20);
        for (const { f } of files) {
          const id = f.replace(/\.jsonl$/, "");
          try {
            const first = readFileSync(join(sessionsDir, f), "utf-8").split("\n")[0];
            const meta = JSON.parse(first);
            const label = meta?.content ? String(meta.content).slice(0, 24).replace(/\n/g, " ") : id.slice(0, 12);
            out.push({ value: id, label, description: id.slice(0, 10) });
          } catch {
            out.push({ value: id, label: id.slice(0, 12) });
          }
        }
      } catch { /* ignore */ }
    }
    setItems(out);
  }, []);

  const onSelect = (value: string) => {
    // 读 jsonl 重建 messages 到 UI（不再只设 id 留空）
    const loaded = loadSessionMessages(value);
    if (loaded) {
      useStore.getState().setMessages(loaded.messages);
      useStore.getState().setSessionId(value);
      useStore.getState().setAutoFollow(true);
      useStore.getState().toastMsg(`已加载会话 ${value.slice(0, 8)}（${loaded.messages.length} 条）`, "ok");
    } else {
      useStore.getState().setSessionId(value);
      useStore.getState().toastMsg(`切换会话 ${value.slice(0, 8)}`, "ok");
    }
    useStore.getState().setOverlay(null);
  };

  return (
    <Overlay title="会话" footer="↑↓ 选择 · Enter 切换 · Esc 关闭" width={50}>
      {items.length === 0 ? (
        <Text color={t.dim}>无历史会话（{projectSessionsDir()}）</Text>
      ) : (
        <SelectList items={items} onSelect={onSelect} />
      )}
    </Overlay>
  );
}
