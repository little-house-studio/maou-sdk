/**
 * 调试面板的数据侧：拉落盘账本里的「本轮 POST 请求 / 本轮返回」。
 *
 * 直播行的 id 是前端 uid()，跟落盘 entry id 对不上，所以走**尾对齐**：
 * 前端 lines 永远是磁盘消息的后缀，两边各自按 role 排队、从末尾往前配对。
 * 配错比不显示更糟，所以对齐前先做一次 output token 一致性抽查。
 */

export type PayloadUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reported: boolean;
};

export type PayloadTurn = {
  kind: "user" | "assistant";
  index: number;
  id: string;
  seq?: number;
  ts?: string;
  round?: number;
  model?: string;
  usage: PayloadUsage;
  toolCalls: number;
  hasRequest: boolean;
  hasResponse: boolean;
};

export type PayloadIndex = {
  ok: boolean;
  file: string | null;
  users: PayloadTurn[];
  turns: PayloadTurn[];
};

export type PayloadRequestView = {
  url?: string;
  method: "POST";
  headers?: Record<string, unknown>;
  body: unknown;
  bytes: number;
};

export type PayloadResponseView = {
  content: string;
  reasoning?: string;
  finishReason?: string;
  validationError?: string;
  toolCalls: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  bytes: number;
};

export type PayloadDetail = PayloadTurn & {
  request: PayloadRequestView | null;
  response: PayloadResponseView | null;
};

/** 一行 transcript 上被回填的落盘坐标 + 缓存分桶 */
export type PayloadHydration = {
  /** 落盘 entry id（新会话有）；老会话为空时回落 payloadIndex */
  payloadId?: string;
  /** 同类消息里的 0 基下标，id 缺失时的定位口径 */
  payloadIndex?: number;
  /** 该会话里的第几条用户消息 / 第几个助手轮（1 基，全会话真值） */
  ordinal?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheReported?: boolean;
  usageInput?: number;
  usageOutput?: number;
};

type HydratableLine = {
  role: string;
  usageInput?: number;
  usageOutput?: number;
} & PayloadHydration;

const EMPTY_INDEX: PayloadIndex = {
  ok: false,
  file: null,
  users: [],
  turns: [],
};

export async function fetchSessionPayloadIndex(
  sessionId: string,
  projectRoot: string,
): Promise<PayloadIndex> {
  const sid = (sessionId || "").trim();
  if (!sid) return EMPTY_INDEX;
  const q = new URLSearchParams({ sessionId: sid, root: projectRoot || "" });
  try {
    const r = await fetch(`/api/session-payloads?${q}`);
    if (!r.ok) return EMPTY_INDEX;
    const j = (await r.json()) as Partial<PayloadIndex>;
    return {
      ok: Boolean(j?.ok),
      file: j?.file ?? null,
      users: Array.isArray(j?.users) ? j.users : [],
      turns: Array.isArray(j?.turns) ? j.turns : [],
    };
  } catch {
    return EMPTY_INDEX;
  }
}

export async function fetchSessionPayloadDetail(
  sessionId: string,
  projectRoot: string,
  kind: "user" | "assistant",
  sel: { id?: string; index?: number },
): Promise<PayloadDetail | null> {
  const sid = (sessionId || "").trim();
  if (!sid) return null;
  const q = new URLSearchParams({ sessionId: sid, root: projectRoot || "", kind });
  if (sel.id) q.set("id", sel.id);
  else if (sel.index != null) q.set("index", String(sel.index));
  else return null;
  const r = await fetch(`/api/session-payload?${q}`);
  const j = (await r.json()) as { ok?: boolean; detail?: PayloadDetail; error?: string };
  if (!r.ok || !j?.ok || !j.detail) {
    throw new Error(j?.error || `HTTP ${r.status}`);
  }
  return j.detail;
}

/**
 * 尾对齐一致性抽查：两边都报了 output token 的配对里，至少六成要相等。
 * 样本不足（<2 对）时放行——新会话首轮本来就没什么可比的。
 */
export function alignmentTrustworthy(
  lines: readonly { usageOutput?: number }[],
  turns: readonly PayloadTurn[],
): boolean {
  let checked = 0;
  let agreed = 0;
  const n = Math.min(lines.length, turns.length);
  for (let i = 0; i < n; i++) {
    const line = lines[lines.length - n + i]!;
    const turn = turns[turns.length - n + i]!;
    if (!line.usageOutput || !turn.usage.output) continue;
    checked += 1;
    if (line.usageOutput === turn.usage.output) agreed += 1;
  }
  if (checked < 2) return true;
  return agreed / checked >= 0.6;
}

/** 把落盘索引尾对齐回填到 transcript：定位 id + 缓存分桶 + 全会话序号。 */
export function applySessionPayloadIndex<T extends HydratableLine>(
  lines: T[],
  index: PayloadIndex,
): T[] {
  if (!index.ok) return lines;
  const userLines = lines.filter((l) => l.role === "user");
  const asstLines = lines.filter((l) => l.role === "assistant");
  const patch = new Map<T, PayloadHydration>();

  const pair = (
    rows: T[],
    turns: readonly PayloadTurn[],
    withUsage: boolean,
  ) => {
    if (turns.length === 0 || rows.length === 0) return;
    if (withUsage && !alignmentTrustworthy(rows, turns)) return;
    const n = Math.min(rows.length, turns.length);
    for (let i = 0; i < n; i++) {
      const row = rows[rows.length - n + i]!;
      const turn = turns[turns.length - n + i]!;
      patch.set(row, {
        ...(turn.id ? { payloadId: turn.id } : {}),
        payloadIndex: turn.index,
        ordinal: turn.index + 1,
        ...(withUsage
          ? {
              cacheRead: turn.usage.cacheRead,
              cacheWrite: turn.usage.cacheWrite,
              cacheReported: turn.usage.reported,
              ...(turn.usage.input > 0 && !row.usageInput
                ? { usageInput: turn.usage.input }
                : {}),
              ...(turn.usage.output > 0 && !row.usageOutput
                ? { usageOutput: turn.usage.output }
                : {}),
            }
          : {}),
      });
    }
  };

  pair(userLines, index.users, false);
  pair(asstLines, index.turns, true);

  if (patch.size === 0) return lines;
  let changed = false;
  const next = lines.map((l) => {
    const p = patch.get(l);
    if (!p) return l;
    const merged = { ...l, ...p };
    for (const k of Object.keys(p) as Array<keyof PayloadHydration>) {
      if (merged[k] !== l[k]) changed = true;
    }
    return merged;
  });
  return changed ? next : lines;
}
