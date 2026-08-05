/**
 * PROACTIVE.md 固定语法 parse / serialize（纯函数，无 Node API）
 *
 * 条目：
 *   - [ ] 改进点 ||| 风险 ||| 建议评语 <!-- note: 备注 -->
 *   - [x] 已完成项 ||| 低 ||| ... <!-- note: ... --> <!-- done: ISO -->
 */

import {
  DEFAULT_PROACTIVE_SETTINGS,
  PROACTIVE_ZONES,
  type ProactiveBoard,
  type ProactiveItem,
  type ProactiveRisk,
  type ProactiveSettings,
  type ProactiveZone,
} from "./types.js";

export type {
  ProactiveBoard,
  ProactiveChatLine,
  ProactiveFrequency,
  ProactiveItem,
  ProactiveJobState,
  ProactiveRisk,
  ProactiveSettings,
  ProactiveZone,
} from "./types.js";
export { DEFAULT_PROACTIVE_SETTINGS, PROACTIVE_ZONES } from "./types.js";

const SEP = "|||";
const ZONE_SET = new Set<string>(PROACTIVE_ZONES);

export function isProactiveZone(s: string): s is ProactiveZone {
  return ZONE_SET.has(s);
}

export function itemId(zone: string, title: string): string {
  const raw = `${zone}::${title.trim()}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  return `pi_${(h >>> 0).toString(36)}`;
}

function parseRisk(s: string): ProactiveRisk | string {
  const t = s.trim();
  if (t === "高" || t === "中" || t === "低") return t;
  const low = t.toLowerCase();
  if (low === "high") return "高";
  if (low === "medium" || low === "med") return "中";
  if (low === "low") return "低";
  return t || "中";
}

/** Parse a single checklist line; null if not an item line. */
export function parseItemLine(
  line: string,
  zone: ProactiveZone | "已完成",
): ProactiveItem | null {
  const m = /^\s*-\s*\[([ xX])\]\s+(.+)$/.exec(line);
  if (!m) return null;
  const done = m[1]!.toLowerCase() === "x";
  let rest = m[2]!.trim();

  let note = "";
  let doneAt: string | undefined;
  const noteM = /<!--\s*note:\s*([\s\S]*?)-->/i.exec(rest);
  if (noteM) {
    note = noteM[1]!.trim();
    rest = rest.replace(noteM[0], "").trim();
  }
  const doneM = /<!--\s*done:\s*([^>]+?)-->/i.exec(rest);
  if (doneM) {
    doneAt = doneM[1]!.trim();
    rest = rest.replace(doneM[0], "").trim();
  }

  const parts = rest.split(SEP).map((p) => p.trim());
  const title = parts[0] || rest;
  if (!title) return null;
  const risk = parseRisk(parts[1] ?? "中");
  const comment = parts[2] ?? "";

  return {
    id: itemId(zone, title),
    zone,
    title,
    risk,
    comment,
    note,
    done: done || zone === "已完成",
    doneAt,
  };
}

export function formatItemLine(item: ProactiveItem): string {
  const box = item.done ? "[x]" : "[ ]";
  let line = `- ${box} ${item.title} ${SEP} ${item.risk} ${SEP} ${item.comment || "—"}`;
  if (item.note.trim()) line += ` <!-- note: ${item.note.trim()} -->`;
  if (item.done && item.doneAt) line += ` <!-- done: ${item.doneAt} -->`;
  return line;
}

export function emptyBoardMarkdown(): string {
  const zones = PROACTIVE_ZONES.map(
    (z) => `## ${z}\n\n_（暂无条目）_\n`,
  ).join("\n");
  return (
    `# 主动智能看板\n\n` +
    `> 固定语法：\`- [ ] 改进点 ||| 风险 ||| 建议评语\`；备注：\`<!-- note: … -->\`。\n` +
    `> 主动 agent 只通过专用看板 API/工具维护本文件；主 coding agent 负责落地实现。\n\n` +
    zones +
    `\n## 已完成\n\n_（暂无）_\n`
  );
}

export function parseProactiveMarkdown(
  raw: string,
  path = ".maou/project/PROACTIVE.md",
): ProactiveBoard {
  const text = raw?.trim() ? raw : emptyBoardMarkdown();
  const lines = text.split(/\r?\n/);
  let zone: ProactiveZone | "已完成" | null = null;
  const items: ProactiveItem[] = [];
  const seenZones = new Set<ProactiveZone>();

  for (const line of lines) {
    const hm = /^##\s+(.+?)\s*$/.exec(line);
    if (hm) {
      const name = hm[1]!.trim();
      if (isProactiveZone(name)) {
        zone = name;
        seenZones.add(name);
      } else if (name === "已完成" || name.startsWith("已完成")) {
        zone = "已完成";
      } else {
        zone = null;
      }
      continue;
    }
    if (!zone) continue;
    const item = parseItemLine(line, zone);
    if (item) items.push(item);
  }

  return {
    path,
    zones: [...PROACTIVE_ZONES],
    items,
    raw: text,
  };
}

/** Rebuild full markdown from items (stable zone order). */
export function serializeProactiveBoard(board: ProactiveBoard): string {
  const open = board.items.filter((i) => !i.done && i.zone !== "已完成");
  const done = board.items.filter((i) => i.done || i.zone === "已完成");

  const parts: string[] = [
    `# 主动智能看板`,
    ``,
    `> 固定语法：\`- [ ] 改进点 ||| 风险 ||| 建议评语\`；备注：\`<!-- note: … -->\`。`,
    `> 主动 agent 维护建议；主 coding agent 落地；完成后勾选并移入「已完成」。`,
    ``,
  ];

  for (const z of PROACTIVE_ZONES) {
    parts.push(`## ${z}`, ``);
    const zs = open.filter((i) => i.zone === z);
    if (zs.length === 0) parts.push(`_（暂无条目）_`, ``);
    else {
      for (const it of zs) parts.push(formatItemLine({ ...it, done: false }));
      parts.push(``);
    }
  }

  parts.push(`## 已完成`, ``);
  if (done.length === 0) parts.push(`_（暂无）_`, ``);
  else {
    for (const it of done) {
      parts.push(
        formatItemLine({
          ...it,
          done: true,
          zone: "已完成",
          doneAt: it.doneAt || new Date().toISOString(),
        }),
      );
    }
    parts.push(``);
  }

  return parts.join("\n");
}

/** Merge scan suggestions: add titles not already open in same zone. */
export function mergeSuggestions(
  board: ProactiveBoard,
  suggestions: Array<{
    zone: ProactiveZone;
    title: string;
    risk?: string;
    comment?: string;
    note?: string;
  }>,
): ProactiveBoard {
  const items = [...board.items];
  const openKeys = new Set(
    items.filter((i) => !i.done).map((i) => `${i.zone}::${i.title.trim()}`),
  );
  for (const s of suggestions) {
    if (!isProactiveZone(s.zone)) continue;
    const title = s.title.trim();
    if (!title) continue;
    const key = `${s.zone}::${title}`;
    if (openKeys.has(key)) continue;
    openKeys.add(key);
    items.push({
      id: itemId(s.zone, title),
      zone: s.zone,
      title,
      risk: parseRisk(s.risk ?? "中"),
      comment: (s.comment ?? "").trim() || "—",
      note: (s.note ?? "").trim(),
      done: false,
    });
  }
  const next = { ...board, items };
  return { ...next, raw: serializeProactiveBoard(next) };
}

export function setItemDone(
  board: ProactiveBoard,
  id: string,
  done: boolean,
): ProactiveBoard {
  const items = board.items.map((i) => {
    if (i.id !== id) return i;
    if (done) {
      return {
        ...i,
        done: true,
        zone: "已完成" as const,
        doneAt: new Date().toISOString(),
      };
    }
    // reopen into original non-done zone if possible
    const z = isProactiveZone(String(i.zone)) ? i.zone : PROACTIVE_ZONES[2];
    return {
      ...i,
      done: false,
      zone: z as ProactiveZone,
      doneAt: undefined,
    };
  });
  const next = { ...board, items };
  return { ...next, raw: serializeProactiveBoard(next) };
}

export function setItemChecked(
  board: ProactiveBoard,
  id: string,
  checked: boolean,
): ProactiveBoard {
  // "checked" for dispatch queue is represented by a synthetic prefix in note: [queue]
  // For UI we track selection in client state; board only stores notes + done.
  // This helper updates note flag for server-side autoZones selection.
  const items = board.items.map((i) => {
    if (i.id !== id || i.done) return i;
    let note = i.note.replace(/\[queue\]\s*/g, "").trim();
    if (checked) note = note ? `[queue] ${note}` : "[queue]";
    return { ...i, note };
  });
  const next = { ...board, items };
  return { ...next, raw: serializeProactiveBoard(next) };
}

export function isQueued(item: ProactiveItem): boolean {
  return /\[queue\]/i.test(item.note);
}

export function normalizeSettings(
  raw: Partial<ProactiveSettings> | null | undefined,
): ProactiveSettings {
  const d = DEFAULT_PROACTIVE_SETTINGS;
  const today = new Date().toISOString().slice(0, 10);
  const freq = raw?.frequency;
  const frequency: ProactiveSettings["frequency"] =
    freq === "after_edit" || freq === "interval" || freq === "off"
      ? freq
      : d.frequency;
  let runsToday = Number(raw?.runsToday ?? 0) || 0;
  let runsDay = String(raw?.runsDay ?? "");
  if (runsDay !== today) {
    runsDay = today;
    runsToday = 0;
  }
  const autoZones = Array.isArray(raw?.autoZones)
    ? (raw!.autoZones!.filter(isProactiveZone) as ProactiveZone[])
    : [...d.autoZones];
  return {
    enabled: Boolean(raw?.enabled ?? d.enabled),
    frequency,
    intervalMinutes: Math.max(
      5,
      Math.min(24 * 60, Number(raw?.intervalMinutes ?? d.intervalMinutes) || 30),
    ),
    maxRunsPerDay: Math.max(
      1,
      Math.min(100, Number(raw?.maxRunsPerDay ?? d.maxRunsPerDay) || 20),
    ),
    autoZones: autoZones.length ? autoZones : [...d.autoZones],
    runsToday,
    runsDay,
    lastScanAt: raw?.lastScanAt,
    lastDispatchAt: raw?.lastDispatchAt,
  };
}

export function canRunToday(s: ProactiveSettings): boolean {
  const n = normalizeSettings(s);
  return n.runsToday < n.maxRunsPerDay;
}

export function bumpRun(s: ProactiveSettings): ProactiveSettings {
  const n = normalizeSettings(s);
  return { ...n, runsToday: n.runsToday + 1, runsDay: n.runsDay };
}

/** Extract ```proactive-json ... ``` suggestions from model text. */
export function parseSuggestionsFromModelText(text: string): Array<{
  zone: ProactiveZone;
  title: string;
  risk?: string;
  comment?: string;
  note?: string;
}> {
  const out: Array<{
    zone: ProactiveZone;
    title: string;
    risk?: string;
    comment?: string;
    note?: string;
  }> = [];
  const fence =
    /```proactive-json\s*([\s\S]*?)```/i.exec(text) ||
    /```json\s*([\s\S]*?)```/i.exec(text);
  if (!fence) return out;
  try {
    const data = JSON.parse(fence[1]!.trim()) as unknown;
    const arr = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
        ? (data as { items: unknown[] }).items
        : [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const zone = String(o.zone ?? "");
      const title = String(o.title ?? o.改进点 ?? "").trim();
      if (!isProactiveZone(zone) || !title) continue;
      out.push({
        zone,
        title,
        risk: o.risk != null ? String(o.risk) : undefined,
        comment:
          o.comment != null
            ? String(o.comment)
            : o.建议评语 != null
              ? String(o.建议评语)
              : undefined,
        note: o.note != null ? String(o.note) : undefined,
      });
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function buildScanUserPrompt(projectRoot: string): string {
  return (
    `你是「主动智能」扫描 agent（只读分析，不直接改业务代码）。\n` +
    `项目根：${projectRoot}\n` +
    `任务：阅读 PROJECT.md / README / 关键源码结构，提出可推进的改进项。\n` +
    `分区只能使用：\n` +
    PROACTIVE_ZONES.map((z) => `- ${z}`).join("\n") +
    `\n\n风险只能用：高 / 中 / 低。\n` +
    `最后必须输出一个 fenced block：\n` +
    "```proactive-json\n" +
    `{"items":[{"zone":"安全无风险修复与优化","title":"...","risk":"低","comment":"..."}]}\n` +
    "```\n" +
    `至少 1 条、最多 12 条；优先具体、可执行；不要重复显而易见的空话。`
  );
}

export function buildDispatchUserMessage(item: ProactiveItem): string {
  return (
    `【主动智能派发】请完成以下改进并在结束后简要说明改动与验证方式。\n\n` +
    `分区：${item.zone}\n` +
    `改进点：${item.title}\n` +
    `风险：${item.risk}\n` +
    `建议：${item.comment}\n` +
    (item.note
      ? `备注：${item.note.replace(/\[queue\]/gi, "").trim()}\n`
      : "") +
    `\n要求：优先小步可合并改动；高风险项先说明方案再改；完成后给出文件列表与如何验证。`
  );
}
