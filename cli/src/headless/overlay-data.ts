/**
 * 为 Ratatui 准备 overlay 列表数据（与 Ink overlay 组件同源逻辑）。
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentCliConfig } from "../types.js";
import { projectSessionsDir } from "../config/paths.js";
import { previewCurrentRequestBundle } from "../lib/preview-system.js";
import type { ProtoOverlay, ProtoSelectItem } from "./protocol-types.js";
import { useStore } from "../state/store.js";
import { commandPaletteItems, helpKeyRows } from "../config/cli-commands.js";
import { settingsForSurface } from "../config/cli-settings.js";

function settingsItems(): ProtoSelectItem[] {
  const s = useStore.getState();
  return settingsForSurface("ratatui", {
    provider: s.provider,
    model: s.model,
    approvalMode: s.approvalMode,
    thinkingLevel: s.thinkingLevel,
    themeName: "",
    perfHud: s.perfHud !== false,
    mouseCapture: s.mouseCapture !== false,
  });
}

export interface BuildOverlayOpts {
  /** 模型二级：已选 provider id；空则列出 providers */
  modelProvider?: string | null;
  /** prompt 当前分段下标 */
  promptSectionIndex?: number;
}

export function buildOverlay(
  kind: string | null | undefined,
  config: AgentCliConfig,
  agentName?: string,
  opts: BuildOverlayOpts = {},
): ProtoOverlay | null {
  if (!kind) return null;
  switch (kind) {
    case "command":
      return {
        kind,
        title: "命令",
        footer: "↑↓ 选择 · Enter 执行 · Esc 关闭",
        items: commandPaletteItems(),
        selected: 0,
      };
    case "model": {
      const providers = config.getProviders?.() ?? [];
      const providerId = opts.modelProvider?.trim() || "";
      if (!providerId) {
        const items: ProtoSelectItem[] = providers.map((p) => {
          const n = (config.getModels?.(p.id) ?? []).length;
          return {
            value: `provider:${p.id}`,
            label: p.name ?? p.id,
            description: n > 0 ? `${n} 个模型` : "无模型",
          };
        });
        return {
          kind,
          title: "选择 Provider",
          footer: "↑↓ 选择 · Enter 进入模型 · Esc 关闭",
          items,
          selected: 0,
        };
      }
      const prov = providers.find((p) => p.id === providerId);
      const items: ProtoSelectItem[] = (config.getModels?.(providerId) ?? []).map(
        (m) => ({
          value: `${providerId}\0${m.id}`,
          label: m.name ?? m.id,
          description: m.id,
        }),
      );
      return {
        kind,
        title: `模型 · ${prov?.name ?? providerId}`,
        footer: "↑↓ 选择 · Enter 切换 · Esc 回 Provider",
        items,
        selected: 0,
      };
    }
    case "sessions": {
      const sessionsDir = projectSessionsDir();
      const items: ProtoSelectItem[] = [];
      if (existsSync(sessionsDir)) {
        try {
          const files = readdirSync(sessionsDir)
            .filter((f) => f.endsWith(".jsonl"))
            .map((f) => ({ f, mtime: statSync(join(sessionsDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 20);
          for (const { f } of files) {
            const id = f.replace(/\.jsonl$/, "");
            try {
              const first = readFileSync(join(sessionsDir, f), "utf-8").split("\n")[0];
              const meta = JSON.parse(first ?? "{}") as { content?: string };
              const label = meta?.content
                ? String(meta.content).slice(0, 24).replace(/\n/g, " ")
                : id.slice(0, 12);
              items.push({ value: id, label, description: id.slice(0, 10) });
            } catch {
              items.push({ value: id, label: id.slice(0, 12) });
            }
          }
        } catch {
          /* ignore */
        }
      }
      return {
        kind,
        title: "会话",
        footer: "↑↓ 选择 · Enter 切换 · Esc 关闭",
        items,
        selected: 0,
      };
    }
    case "help":
      return {
        kind,
        title: "帮助",
        footer: "Esc 关闭",
        items: [],
        lines: helpKeyRows().map(([k, d]) => `${k.padEnd(22)} ${d}`),
        selected: 0,
      };
    case "settings":
      return {
        kind,
        title: "设置",
        footer: "↑↓ 选择 · Enter · Esc 关闭",
        items: settingsItems(),
        selected: 0,
      };
    case "agents": {
      const entries = config.listAgents?.() ?? [];
      const items: ProtoSelectItem[] = [];
      const main = entries.filter((e) => !e.parent);
      const subs = entries.filter((e) => !!e.parent);
      for (const e of main) {
        items.push({
          value: e.name,
          label: `▌ ${e.display_name || e.name}`,
          description: `${e.role || "agent"} · ${e.status || "idle"}`,
        });
      }
      if (subs.length > 0) {
        items.push({ value: "__subs__", label: "── 子 agent ──", description: "" });
        for (const e of subs) {
          items.push({
            value: `sub:${e.name}`,
            label: `  └ ${e.display_name || e.name}`,
            description: `${e.role || ""} · parent:${e.parent}`,
          });
        }
      }
      if (items.length === 0) {
        items.push({ value: config.name, label: config.name });
      }
      return {
        kind,
        title: "Agent",
        footer: "↑↓ 选择 · Enter 切换 · →/Esc 关闭",
        items,
        selected: 0,
      };
    }
    case "prompt": {
      try {
        const bundle = previewCurrentRequestBundle(agentName || config.name);
        if (!bundle.ok) {
          return {
            kind,
            title: "Request Preview",
            footer: "Esc 关闭（不进上下文 · 调试用）",
            items: [],
            lines: [`（编译失败）`, bundle.error ?? "unknown error"],
            selected: 0,
          };
        }
        const sections = bundle.sections ?? [];
        if (sections.length === 0) {
          const text = bundle.combined || bundle.text || "(空)";
          return {
            kind,
            title: "Request Preview",
            footer: "↑↓ 滚动 · Esc 关闭",
            items: [],
            lines: text.split("\n").slice(0, 2000),
            selected: 0,
          };
        }
        const rawIdx = opts.promptSectionIndex ?? 0;
        const idx = Math.max(0, Math.min(rawIdx, sections.length - 1));
        const sec = sections[idx]!;
        const body = (sec.body || "").split("\n").slice(0, 2000);
        const tab = sections
          .map((s, i) => (i === idx ? `[${s.title}]` : s.title))
          .join(" · ");
        return {
          kind,
          title: `Request Preview · ${sec.title}`,
          footer: `[ ]/Tab 切段 · 0-9 · ↑↓ 滚动 · Esc · ${idx + 1}/${sections.length}`,
          items: [],
          lines: [
            tab.slice(0, 200),
            `── ${sec.title}${sec.note ? ` · ${sec.note}` : ""} · ${sec.charCount} chars ──`,
            ...body,
          ],
          sections: sections.map((s) => ({
            value: s.id,
            label: s.title,
            description: `${s.lineCount} lines`,
          })),
          section_index: idx,
          selected: 0,
        };
      } catch (e) {
        return {
          kind,
          title: "Request Preview",
          footer: "Esc 关闭",
          items: [],
          lines: [`预览失败: ${e instanceof Error ? e.message : e}`],
          selected: 0,
        };
      }
    }
    default:
      return {
        kind,
        title: kind,
        footer: "Esc 关闭",
        items: [],
        selected: 0,
      };
  }
}
