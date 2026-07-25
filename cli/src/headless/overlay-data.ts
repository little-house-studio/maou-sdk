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
import { getActiveTheme, listThemesMeta } from "../theme/load-theme.js";
import {
  agentPresenceKey,
  resolvePresenceStatus,
  reloadPresenceFromDisk,
  getAgentPresence,
  markAgentRunning,
  markChildRunning,
} from "../state/agent-presence.js";

type AgentListEntry = {
  name: string;
  display_name?: string;
  parent?: string;
  role?: string;
  status?: string;
  description?: string;
  notes?: string;
  group?: string;
  project_path?: string;
  project_name?: string;
  switch_id?: string;
  stale?: boolean;
};

function syncLifecycleIntoPresence(): void {
  try {
    void import("@little-house-studio/agent")
      .then((agentPkg) => {
        const life = (
          agentPkg as {
            AgentLifecycleManager?: {
              global: () => {
                list: () => Array<{ sessionId: string; agentName: string; status: string }>;
              };
            };
          }
        ).AgentLifecycleManager?.global?.();
        if (!life) return;
        for (const row of life.list()) {
          const key = agentPresenceKey(row.agentName, null);
          if (row.status === "running") {
            markAgentRunning(key);
            if (row.sessionId.includes("::fork::") || row.sessionId.includes("sub")) {
              markChildRunning(key, row.agentName, true);
            }
          }
        }
      })
      .catch(() => {});
  } catch { /* ignore */ }
}

function buildAgentsPage(
  config: AgentCliConfig,
  agentName?: string,
): ProtoOverlay {
  // 多窗口：先拉磁盘 presence，再合并本进程 lifecycle
  try {
    reloadPresenceFromDisk();
  } catch { /* ignore */ }
  syncLifecycleIntoPresence();

  const store = useStore.getState();
  const entries = (config.listAgents?.() ?? []) as AgentListEntry[];
  const items: ProtoSelectItem[] = [];
  const curName = agentName || store.agentName || config.name;
  const curProject = store.agentProjectRoot ?? null;

  const system = entries.filter((e) => (e.group ?? "system") === "system" && !e.parent);
  const systemSubs = entries.filter((e) => (e.group ?? "system") === "system" && !!e.parent);
  const projects = entries.filter((e) => e.group === "project" && !e.parent);
  const projectSubs = entries.filter((e) => e.group === "project" && !!e.parent);
  const freshProjects = projects.filter((e) => !e.stale);
  const staleProjects = projects.filter((e) => e.stale);

  const pushHeader = (label: string) => {
    items.push({
      value: `__hdr_${items.length}`,
      label,
      row_kind: "header",
      selectable: false,
    });
  };

  const pushSpacer = () => {
    items.push({
      value: `__sp_${items.length}`,
      label: "",
      row_kind: "spacer",
      selectable: false,
    });
  };

  const isCurrent = (name: string, projectPath?: string) => {
    if (projectPath) {
      return curName === name && curProject === projectPath;
    }
    return curName === name && !curProject;
  };

  const pushAgent = (opts: {
    e: AgentListEntry;
    glyph: string;
    depth: number;
    rowKind: "agent" | "sub";
    title: string;
    overview: string;
    canDelete: boolean;
  }) => {
    const projectPath = opts.e.project_path;
    const switchId = String(opts.e.switch_id || opts.e.name);
    const key = agentPresenceKey(opts.e.name, projectPath ?? null);
    const current = isCurrent(opts.e.name, projectPath);
    const status = resolvePresenceStatus(key, {
      isCurrent: current,
      streaming: store.streaming,
      agentBusy: store.agentBusy,
      hasApproval: Boolean(store.terminalApproval),
      stale: opts.e.stale,
    });
    items.push({
      value: switchId,
      label: opts.title,
      description: opts.overview,
      overview: opts.overview,
      row_kind: opts.rowKind,
      glyph: opts.glyph,
      status: opts.e.stale ? "idle" : status,
      depth: opts.depth,
      selectable: true,
      can_stop: current && (store.streaming || store.agentBusy),
      can_delete: opts.canDelete && !current,
      stale: Boolean(opts.e.stale),
    });
  };

  // ── 系统主 agent（置顶）──
  if (system.length > 0 || config.scope === "global") {
    pushHeader("系统 Agent");
    const sysList = system.length > 0
      ? system
      : [{
          name: config.name,
          display_name: config.name,
          group: "system",
          switch_id: `system:${config.name}`,
          notes: "当前产品",
        } as AgentListEntry];

    for (const e of sysList) {
      const pk = agentPresenceKey(e.name, null);
      const cached = getAgentPresence(pk).overview;
      const overview = String(
        cached || e.notes || e.description || e.role || "机器级助手",
      ).slice(0, 56);
      pushAgent({
        e,
        glyph: "◆",
        depth: 0,
        rowKind: "agent",
        title: e.display_name || e.name,
        overview,
        canDelete: false,
      });
      // 子 agent：默认折叠仅显示「有子」时的折叠提示；运行中的子列出
      const subs = systemSubs.filter((x) => x.parent === e.name);
      if (subs.length > 0) {
        for (const s of subs) {
          pushAgent({
            e: s,
            glyph: "◇",
            depth: 1,
            rowKind: "sub",
            title: s.display_name || s.name,
            overview: String(s.description || s.role || "").slice(0, 48),
            canDelete: true,
          });
        }
      }
    }
  }

  // ── 项目 agent（7 天内活跃）──
  if (freshProjects.length > 0) {
    pushSpacer();
    pushHeader("项目 Agent · 最近活跃");
    for (const e of freshProjects) {
      const title = e.project_name || e.display_name || e.name;
      const overview = String(e.notes || e.project_path || e.description || "").slice(0, 64);
      pushAgent({
        e,
        glyph: "●",
        depth: 0,
        rowKind: "agent",
        title,
        overview,
        canDelete: false,
      });
      const subs = projectSubs.filter((x) => x.project_path === e.project_path);
      // 有子 agent：运行中的列出；未运行折叠为一行提示
      const runningSubs = subs.filter((s) => {
        const st = resolvePresenceStatus(
          agentPresenceKey(s.name, s.project_path ?? null),
          { isCurrent: false, stale: false },
        );
        return st === "running" || st === "blocked";
      });
      if (runningSubs.length > 0) {
        for (const s of runningSubs) {
          pushAgent({
            e: s,
            glyph: "○",
            depth: 1,
            rowKind: "sub",
            title: s.display_name || s.name,
            overview: String(s.description || "").slice(0, 48),
            canDelete: true,
          });
        }
        const folded = subs.length - runningSubs.length;
        if (folded > 0) {
          items.push({
            value: `__fold_${e.project_path}`,
            label: `另有 ${folded} 个未运行子 agent`,
            row_kind: "header",
            depth: 1,
            selectable: false,
            status: "idle",
          });
        }
      } else if (subs.length > 0) {
        items.push({
          value: `__fold_${e.project_path}`,
          label: `${subs.length} 个子 agent（未运行，已折叠）`,
          row_kind: "header",
          depth: 1,
          selectable: false,
          status: "idle",
        });
      }
    }
  }

  // ── 休眠项目（>7 天）仅主 agent，全灰 ──
  if (staleProjects.length > 0) {
    pushSpacer();
    pushHeader("休眠项目 · 超过 7 天未运行");
    for (const e of staleProjects) {
      const title = e.project_name || e.display_name || e.name;
      pushAgent({
        e: { ...e, stale: true },
        glyph: "●",
        depth: 0,
        rowKind: "agent",
        title,
        overview: String(e.project_path || "").slice(0, 64),
        canDelete: false,
      });
    }
  }

  // 兼容：无 group 的旧 listAgents
  if (items.length === 0) {
    for (const e of entries.filter((x) => !x.parent)) {
      items.push({
        value: e.name,
        label: e.display_name || e.name,
        description: `${e.role || "agent"}`,
        row_kind: "agent",
        glyph: "●",
        status: "idle",
        depth: 0,
        selectable: true,
      });
    }
  }

  if (items.length === 0) {
    items.push({
      value: `system:${config.name}`,
      label: config.name,
      row_kind: "agent",
      glyph: "◆",
      status: "idle",
      selectable: true,
      depth: 0,
    });
  }

  let selected = items.findIndex((it) => it.selectable !== false);
  if (selected < 0) selected = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.selectable === false) continue;
    const v = it.value;
    if (
      v === `system:${curName}` ||
      (curProject && v === `project:${curProject}:${curName}`) ||
      v === curName
    ) {
      selected = i;
      break;
    }
  }

  return {
    kind: "agents",
    title: "Agent",
    footer:
      "↑↓ 移动 · Enter 切换 · S 停止当前 · D 删除子agent（需确认）· Esc 关闭  |  ◆系统 ●项目  灰空闲 橙运行 绿未读 黄待操作 红待回复",
    items,
    selected,
    full_page: true,
  };
}

function settingsItems(): ProtoSelectItem[] {
  const s = useStore.getState();
  let themeName = "";
  try {
    const th = getActiveTheme();
    themeName = th.name || th.id;
  } catch {
    themeName = "";
  }
  return settingsForSurface("ratatui", {
    provider: s.provider,
    model: s.model,
    approvalMode: s.approvalMode,
    thinkingLevel: s.thinkingLevel,
    themeName,
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
    case "theme": {
      let currentId = "";
      try {
        currentId = getActiveTheme().id;
      } catch {
        /* ignore */
      }
      const items: ProtoSelectItem[] = listThemesMeta().map((th) => ({
        value: th.id,
        label: th.name,
        description:
          th.id === currentId
            ? `当前 · ${th.source}`
            : th.source === "user"
              ? "用户 ~/.maou/themes"
              : "内置 assets/themes",
      }));
      return {
        kind,
        title: "配色方案",
        footer: "↑↓ 选择 · Enter 应用并保存 · Esc 关闭",
        items,
        selected: Math.max(
          0,
          items.findIndex((it) => it.value === currentId),
        ),
      };
    }
    case "agents": {
      return buildAgentsPage(config, agentName);
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
