/**
 * Agent runtime 恢复/防护纯逻辑（max_tokens 续写、工具循环检测、并行资源冲突）。
 * 无 I/O，供 runtime 与单元测试共用。
 */

import {
  normalizeStopReason,
  needsContinuation,
  type StopReason,
} from "@little-house-studio/llm";

// ── max_tokens / finishReason 截断续写 ─────────────────────────────────────

/** 模型输出是否因 max_tokens 被截断（需要续写）。 */
export function isOutputTruncatedByLength(
  finishReason: string | null | undefined,
): boolean {
  return needsContinuation(normalizeStopReason(finishReason));
}

export function normalizeAgentStopReason(
  finishReason: string | null | undefined,
): StopReason {
  return normalizeStopReason(finishReason);
}

/**
 * 在截断正文末尾加标志（DESIGN：让模型知道刚流到这里、请继续）。
 * 已有标志则不重复追加。
 */
export const TRUNCATION_MARKER =
  "\n\n【系统】输出因长度限制被截断，请从断点无缝续写，不要重复已输出内容。";

export function appendTruncationMarker(content: string): string {
  const c = content ?? "";
  if (c.includes("【系统】输出因长度限制被截断")) return c;
  return c + TRUNCATION_MARKER;
}

/**
 * 注入会话的续写控制提示（靠后 user/system_notice 形态，由调用方 append）。
 */
export function buildLengthContinuationControl(opts: {
  round: number;
  hasToolCalls: boolean;
}): string {
  if (opts.hasToolCalls) {
    return (
      `<continue>你上一轮输出因 max_tokens 被截断，但已发出工具调用。` +
      `工具结果已在上方。请根据工具结果继续完成任务；若正文未写完，从断点续写，勿重复已有段落。</continue>`
    );
  }
  return (
    `<continue>你上一轮输出因 max_tokens（length）被截断。` +
    `请从断点无缝续写，不要重复已输出内容，不要道歉，直接接着写。</continue>`
  );
}

export const MAX_LENGTH_CONTINUATIONS = 3;

// ── 工具调用死循环检测 ─────────────────────────────────────────────────────

/** 稳定签名：工具名 + 关键参数指纹（path/command/action 等）。 */
export function toolCallSignature(tc: {
  name?: string;
  parameters?: Record<string, unknown>;
}): string {
  const name = String(tc.name ?? "?").trim() || "?";
  const p = tc.parameters ?? {};
  const keys = ["path", "file_path", "command", "action", "old_text", "pattern", "query", "symbol"];
  const parts: string[] = [name];
  for (const k of keys) {
    const v = p[k];
    if (v === undefined || v === null || v === "") continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${s.slice(0, 120)}`);
  }
  // fallback: sorted short fingerprint of params
  if (parts.length === 1) {
    try {
      const raw = JSON.stringify(p);
      parts.push(raw.slice(0, 160));
    } catch {
      /* ignore */
    }
  }
  return parts.join("|");
}

/**
 * 最近签名窗口内是否陷入重复工具模式。
 * 规则：窗口填满且同一签名占比 ≥ 70%（与 DefaultAgentLoop.detectLoop 一致，但用真签名）。
 */
export function detectRepeatedToolLoop(
  recentSignatures: string[],
  opts?: { window?: number; ratio?: number },
): { looping: boolean; dominant?: string; count?: number } {
  const window = opts?.window ?? 10;
  const ratio = opts?.ratio ?? 0.7;
  if (recentSignatures.length < Math.min(3, window)) {
    return { looping: false };
  }
  const slice = recentSignatures.slice(-window);
  if (slice.length < 3) return { looping: false };
  const counts = new Map<string, number>();
  for (const s of slice) counts.set(s, (counts.get(s) ?? 0) + 1);
  let dominant = "";
  let max = 0;
  for (const [k, n] of counts) {
    if (n > max) {
      max = n;
      dominant = k;
    }
  }
  const looping = max >= Math.ceil(slice.length * ratio);
  return looping ? { looping: true, dominant, count: max } : { looping: false };
}

export function buildToolLoopControl(dominant?: string): string {
  const hint = dominant
    ? `重复模式近似：${dominant.slice(0, 200)}`
    : "相同工具调用模式反复出现";
  return (
    `<continue>系统检测到工具调用可能陷入死循环（${hint}）。` +
    `请换策略：换工具、改参数、或直接用文字总结并停止重复调用。若任务确实需要相同操作，请说明原因后再继续。</continue>`
  );
}

// ── 同轮并行/同批资源冲突 ───────────────────────────────────────────────────

/** 会改写路径的工具（同 path 多调用视为冲突）。 */
const MUTATING_PATH_TOOLS = new Set([
  "edit_file",
  "write_file",
  "edit",
  "write",
]);

/** 从工具参数提取规范化 path（若有）。 */
export function extractToolResourceKey(tc: {
  name?: string;
  parameters?: Record<string, unknown>;
}): string | null {
  const name = String(tc.name ?? "").trim();
  const p = tc.parameters ?? {};
  const pathRaw = p.path ?? p.file_path ?? p.file;
  if (typeof pathRaw === "string" && pathRaw.trim()) {
    // normalize slashes, strip trailing /
    let path = pathRaw.trim().replace(/\\/g, "/");
    while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const kind = MUTATING_PATH_TOOLS.has(name) ? "write" : "path";
    return `${kind}:${path}`;
  }
  if (name === "use_terminal" || name === "terminal") {
    const cmd = p.command;
    if (typeof cmd === "string" && cmd.trim()) {
      return `term:${cmd.trim().slice(0, 200)}`;
    }
  }
  return null;
}

export type ToolResourceConflict = {
  /** index in toolCalls array that should be blocked */
  index: number;
  toolName: string;
  resourceKey: string;
  /** index of the first claimer */
  conflictWithIndex: number;
  message: string;
};

/**
 * 同批 tool_calls 中，多个写操作指向同一 path → 后者冲突。
 * 只拦「写类」工具之间的冲突；读+写同 path 允许（先读后写由工具自身 gate）。
 * 两个相同 use_terminal 命令也拦（防双开破坏性命令）。
 */
export function findSameRoundResourceConflicts(
  toolCalls: Array<{ name?: string; parameters?: Record<string, unknown> }>,
): ToolResourceConflict[] {
  const firstOwner = new Map<string, { index: number; name: string }>();
  const conflicts: ToolResourceConflict[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]!;
    const name = String(tc.name ?? "").trim();
    const key = extractToolResourceKey(tc);
    if (!key) continue;

    // 只对写 path / 终端命令做互斥；只读 path: 不占写锁
    const isMutating =
      key.startsWith("write:") ||
      key.startsWith("term:") ||
      MUTATING_PATH_TOOLS.has(name);
    if (!isMutating) continue;

    const prev = firstOwner.get(key);
    if (prev !== undefined) {
      conflicts.push({
        index: i,
        toolName: name,
        resourceKey: key,
        conflictWithIndex: prev.index,
        message:
          `❌ 同轮工具资源冲突：\`${name}\` 与 #${prev.index + 1} \`${prev.name}\` ` +
          `操作同一资源（${key}）。本调用已跳过，避免并行/连写互相覆盖。` +
          `请串行：先等前一次结果，再发起下一次修改。`,
      });
      continue;
    }
    firstOwner.set(key, { index: i, name });
  }
  return conflicts;
}
