/**
 * 为 Ratatui 准备 overlay 列表数据（与 Ink overlay 组件同源逻辑）。
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentCliConfig } from "../types.js";
import { projectSessionsDir } from "../config/paths.js";
import { previewCurrentRequestBundle } from "../lib/preview-system.js";
import type { ProtoOverlay, ProtoSelectItem } from "./protocol-types.js";

const COMMANDS: ProtoSelectItem[] = [
  { value: "new", label: "新对话", description: "清屏 · 画廊 · /new" },
  { value: "model", label: "选择模型", description: "Ctrl+M" },
  { value: "sessions", label: "切换会话", description: "历史会话" },
  { value: "prompt", label: "Request Preview", description: "/prompt 调试 system·tools·before_user" },
  { value: "settings", label: "设置", description: "Ctrl+," },
  { value: "agents", label: "Agent 管理", description: "空输入框 ←" },
  { value: "help", label: "帮助", description: "快捷键" },
  { value: "screenshot", label: "整屏截图", description: "Ctrl+G" },
  { value: "thinking", label: "切换思考级别", description: "" },
  { value: "quit", label: "退出", description: "Ctrl+C" },
];

const HELP_KEYS: [string, string][] = [
  ["Enter", "发送"],
  ["Alt+Enter", "换行"],
  ["Tab / Shift+Tab", "补全确认 / 切换审核模式"],
  ["Ctrl+K", "命令面板"],
  ["Ctrl+M", "选择模型"],
  ["Ctrl+N", "新对话"],
  ["Ctrl+E", "全屏编辑器"],
  ["Ctrl+G", "整屏文字截图"],
  ["Ctrl+S", "音效开关"],
  ["Esc", "取消/返回/关闭"],
  ["Ctrl+C", "同 Esc；无可取消时连按退出"],
  ["/new /clear", "新会话 / 清空"],
  ["/compact", "强制压缩上下文"],
  ["/usage /cost", "会话用量"],
  ["/context", "上下文占用"],
  ["/prompt", "调试预览最终发给 AI 的请求材料"],
];

const SETTINGS: ProtoSelectItem[] = [
  { value: "approval", label: "审核模式", description: "Shift+Tab 循环 normal/auto/yolo" },
  { value: "thinking", label: "思考级别", description: "循环 0–5" },
  { value: "sound", label: "音效开关", description: "Ctrl+S" },
  { value: "help", label: "打开帮助", description: "" },
];

export function buildOverlay(
  kind: string | null | undefined,
  config: AgentCliConfig,
  agentName?: string,
): ProtoOverlay | null {
  if (!kind) return null;
  switch (kind) {
    case "command":
      return {
        kind,
        title: "命令",
        footer: "↑↓ 选择 · Enter 执行 · Esc 关闭",
        items: COMMANDS,
        selected: 0,
      };
    case "model": {
      const providers = config.getProviders?.() ?? [];
      const items: ProtoSelectItem[] = providers.flatMap((p) =>
        (config.getModels?.(p.id) ?? []).map((m) => ({
          value: `${p.id}\0${m.id}`,
          label: `${p.name ?? p.id} // ${m.name ?? m.id}`,
        })),
      );
      return {
        kind,
        title: "模型",
        footer: "↑↓ 选择 · Enter 切换 · Esc 关闭",
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
        lines: HELP_KEYS.map(([k, d]) => `${k.padEnd(22)} ${d}`),
        selected: 0,
      };
    case "settings":
      return {
        kind,
        title: "设置",
        footer: "↑↓ 选择 · Enter · Esc 关闭",
        items: SETTINGS,
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
      let text = "(空)";
      try {
        const bundle = previewCurrentRequestBundle(agentName || config.name);
        text = bundle.ok
          ? bundle.combined
          : `（编译失败）\n${bundle.error ?? "unknown error"}`;
      } catch (e) {
        text = `预览失败: ${e instanceof Error ? e.message : e}`;
      }
      return {
        kind,
        title: "Request Preview（system/bake/tools/before_user…）",
        footer: "↑↓ 滚动 · Esc 关闭（不进上下文 · 调试用）",
        items: [],
        // Ratatui overlay 可滚；给够行数看完整 dump
        lines: text.split("\n").slice(0, 2000),
        selected: 0,
      };
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
