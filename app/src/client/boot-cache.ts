/**
 * 开机快照：上次看到的 Agent 列表 / 会话列表 / 线程 / 上下文占用。
 * 下次开机首帧同步读出来直接画，hub 就绪后由真数据整份替换 —— 只影响「出现得多早」，不改怎么画。
 *
 * localStorage：同步读才能赶上首帧。写入合并到空闲时，页面隐藏 / 关闭前补刷；
 * 读写出错（隐私模式、配额、坏 JSON）一律当没缓存。
 */

import type { ActivityAgentInfo, LiveAgentInfo, Meta, SessionSummary } from "./api";

const PREFIX = "maou.boot.v1:";
const SHELL_KEY = `${PREFIX}shell`;
const CHAT_PREFIX = `${PREFIX}chat:`;
const CHAT_INDEX_KEY = `${PREFIX}chat-index`;
/** 聊天快照只留最近用过的几个 Agent。 */
const CHAT_KEEP = 3;
/** 单条快照上限（UTF-16 字符）；线程太长就从旧的一头裁。 */
export const MAX_ENTRY_CHARS = 1_200_000;
/** 线程快照最多留这么多行（首屏够用，真数据马上会换掉）。 */
export const MAX_CACHED_LINES = 80;
const WRITE_DELAY_MS = 1200;

export type BootShell = {
  agents: LiveAgentInfo[];
  activeAgentName: string;
  activeSwitchId: string;
  activeProjectPath: string | null;
  activityAgents: ActivityAgentInfo[];
  meta: Meta | null;
  today?: { date: string; input: number; output: number };
};

/** 线程行按 ChatPanel 的 ChatLine 原样存（泛型免得循环引用）。 */
export type BootChat<L = unknown> = {
  sessionId: string | null;
  meta: Meta | null;
  sessions: SessionSummary[];
  lines: L[];
  hasMore: boolean;
  oldestSeq: number | null;
  contextUsage: { used: number; max: number } | null;
  contextBreakdown: unknown;
  maxContext: number;
  providers: { id: string; name?: string }[];
  models: { id: string; name?: string }[];
  approval: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let storage: StorageLike | null | undefined;
function store(): StorageLike | null {
  if (storage === undefined) storage = defaultStorage();
  return storage;
}

/** 测试注入。 */
export function setBootStorage(s: StorageLike | null): void {
  storage = s;
  pending.clear();
  if (timer != null) clearTimeout(timer);
  timer = null;
}

function readJson<T>(key: string): T | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, raw: string): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(key, raw);
    return true;
  } catch {
    // 配额满：清掉聊天快照再试一次
    try {
      for (const k of readChatIndex()) s.removeItem(chatKey(k));
      s.removeItem(CHAT_INDEX_KEY);
      s.setItem(key, raw);
      return true;
    } catch {
      return false;
    }
  }
}

function chatKey(scope: string): string {
  return `${CHAT_PREFIX}${scope}`;
}

function readChatIndex(): string[] {
  const v = readJson<unknown>(CHAT_INDEX_KEY);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function isShell(v: unknown): v is BootShell {
  const o = v as BootShell | null;
  return Boolean(o && Array.isArray(o.agents) && typeof o.activeSwitchId === "string");
}

function isChat(v: unknown): v is BootChat {
  const o = v as BootChat | null;
  return Boolean(o && Array.isArray(o.lines) && Array.isArray(o.sessions));
}

export function readBootShell(): BootShell | null {
  const v = readJson<unknown>(SHELL_KEY);
  return isShell(v) ? v : null;
}

export function readBootChat<L>(scope: string): BootChat<L> | null {
  if (!scope) return null;
  const v = readJson<unknown>(chatKey(scope));
  return isChat(v) ? (v as BootChat<L>) : null;
}

/**
 * 线程裁到能存下：先按行数截尾，再超字数就继续砍最旧的行。
 * 裁过就标 hasMore（往上翻时照常去 hub 拉）。
 */
export function fitChatSnapshot<L extends { seq?: number }>(
  snap: BootChat<L>,
  maxChars = MAX_ENTRY_CHARS,
): string | null {
  let lines = snap.lines.length > MAX_CACHED_LINES ? snap.lines.slice(-MAX_CACHED_LINES) : snap.lines;
  let trimmed = lines.length < snap.lines.length;
  for (;;) {
    const oldestSeq = trimmed ? (lines.find((l) => typeof l.seq === "number")?.seq ?? snap.oldestSeq) : snap.oldestSeq;
    const raw = JSON.stringify({ ...snap, lines, hasMore: snap.hasMore || trimmed, oldestSeq });
    if (raw.length <= maxChars) return raw;
    if (lines.length <= 1) return null;
    lines = lines.slice(Math.ceil(lines.length / 4));
    trimmed = true;
  }
}

const pending = new Map<string, () => string | null>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** 立刻落盘所有排队的快照（pagehide / 测试用）。 */
export function flushBootWrites(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
  const jobs = [...pending];
  pending.clear();
  for (const [key, build] of jobs) {
    const raw = build();
    if (raw == null) continue;
    if (!writeRaw(key, raw)) continue;
    if (key.startsWith(CHAT_PREFIX)) touchChatIndex(key.slice(CHAT_PREFIX.length));
  }
}

function touchChatIndex(scope: string): void {
  const s = store();
  if (!s) return;
  const index = [scope, ...readChatIndex().filter((k) => k !== scope)];
  for (const old of index.slice(CHAT_KEEP)) {
    try {
      s.removeItem(chatKey(old));
    } catch {
      /* ignore */
    }
  }
  writeRaw(CHAT_INDEX_KEY, JSON.stringify(index.slice(0, CHAT_KEEP)));
}

/** 同一键只留最后一次；序列化推迟到真正写的时候。 */
function schedule(key: string, build: () => string | null): void {
  if (!store()) return;
  pending.set(key, build);
  if (timer != null) return;
  timer = setTimeout(() => {
    timer = null;
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (idle) idle(flushBootWrites, { timeout: 2000 });
    else flushBootWrites();
  }, WRITE_DELAY_MS);
}

/** 内容没变就不写，省掉轮询每 2.5 秒一次的序列化 + 磁盘写。 */
const lastWritten = new Map<string, string>();

export function saveBootShell(shell: BootShell): void {
  schedule(SHELL_KEY, () => {
    const raw = JSON.stringify(shell);
    return lastWritten.get(SHELL_KEY) === raw ? null : raw;
  });
}

export function saveBootChat<L extends { seq?: number }>(scope: string, snap: BootChat<L>): void {
  if (!scope) return;
  schedule(chatKey(scope), () => {
    const raw = fitChatSnapshot(snap);
    return raw != null && lastWritten.get(chatKey(scope)) === raw ? null : raw;
  });
}

let flushBound = false;
/** 页面隐藏 / 关闭前把排队的快照写掉。 */
export function bindBootFlush(target: Pick<Window, "addEventListener"> = window): void {
  if (flushBound) return;
  flushBound = true;
  target.addEventListener("pagehide", flushBootWrites);
  target.addEventListener("visibilitychange", () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") flushBootWrites();
  });
}

/** 真数据回来时从快照行补上异步回填的字段，免得工具标题 / 编号先消失再出现。 */
const CARRY_KEYS = [
  "toolDescription",
  "durationMs",
  "payloadId",
  "payloadIndex",
  "ordinal",
  "cacheRead",
  "cacheWrite",
  "cacheReported",
  "usageInput",
  "usageOutput",
] as const;

export function carryBootHydration<L extends { id: string }>(cached: readonly L[], next: L[]): L[] {
  if (!cached.length || !next.length) return next;
  const byId = new Map(cached.map((l) => [l.id, l] as const));
  let changed = false;
  const out = next.map((line) => {
    const old = byId.get(line.id) as Record<string, unknown> | undefined;
    if (!old) return line;
    let patch: Record<string, unknown> | null = null;
    for (const k of CARRY_KEYS) {
      if ((line as Record<string, unknown>)[k] === undefined && old[k] !== undefined) {
        (patch ??= {})[k] = old[k];
      }
    }
    if (!patch) return line;
    changed = true;
    return { ...line, ...patch } as L;
  });
  return changed ? out : next;
}
