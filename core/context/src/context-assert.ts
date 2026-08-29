/**
 * 开发模式重放断言（MAOU_CONTEXT_ASSERT=1）。
 *
 * 压缩、harness 工作集复用、冷恢复都会重建同一段稳定前缀（system 区 + 文件缓存区
 * + 压缩摘要）。这段前缀只该在压缩时变——它一变，厂商侧的 prompt cache 就全废，
 * 而且说明有人悄悄改了历史。开着断言时把前缀摘要记进 meta，下一轮对不上就报警。
 *
 * 默认关闭：这是给开发者查漂移用的，不进生产热路径。
 */

import { createHash } from "node:crypto";

export const CONTEXT_ASSERT_ENV = "MAOU_CONTEXT_ASSERT";

export function contextAssertEnabled(): boolean {
  const v = process.env[CONTEXT_ASSERT_ENV];
  return v === "1" || v === "true";
}

export interface ContextStructure {
  /** 稳定前缀的内容摘要 */
  prefixHash: string;
  /** 前缀条数（历史段起点） */
  prefixCount: number;
  /** 整包条数，只用于报警时给人看 */
  total: number;
}

export interface ContextAssertRecord extends ContextStructure {
  /** 记录时的 replace_generation：压缩会 bump 它，前缀合法变更都伴随它变 */
  generation: number;
}

function digest(parts: string[]): string {
  const h = createHash("sha1");
  for (const p of parts) {
    h.update(p);
    h.update("\u0000");
  }
  return h.digest("hex").slice(0, 16);
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const o = part as Record<string, unknown>;
          if (typeof o.text === "string") return o.text;
          // 图片等二进制部件只记类型，不把 base64 拉进哈希
          return `<${String(o.type ?? "part")}>`;
        }
        return "";
      })
      .join("\n");
  }
  if (value == null) return "";
  return JSON.stringify(value);
}

/** 稳定前缀（messages[0..prefixCount)）的结构摘要。 */
export function contextStructure(
  messages: Array<Record<string, unknown>>,
  prefixCount: number,
): ContextStructure {
  const n = Math.max(0, Math.min(prefixCount, messages.length));
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = messages[i]!;
    parts.push(String(m.role ?? ""), contentText(m.content));
  }
  return { prefixHash: digest(parts), prefixCount: n, total: messages.length };
}

// buildMessages 是纯函数且被到处调用，不给它加参数：断言开着时把上一次的结构
// latch 在这里，由调用方取走。关着时永远是 null。
let latched: ContextStructure | null = null;

export function noteContextStructure(
  messages: Array<Record<string, unknown>>,
  prefixCount: number,
): void {
  if (!contextAssertEnabled()) return;
  latched = contextStructure(messages, prefixCount);
}

/** 取走上一次 buildMessages 记下的结构；取完清空。 */
export function takeContextStructure(): ContextStructure | null {
  const s = latched;
  latched = null;
  return s;
}

/**
 * 前缀漂移的人话描述；没漂移返回 null。
 *
 * generation 变了说明压缩合法改写了前缀，那不算漂移。
 */
export function describeContextDrift(
  prev: ContextAssertRecord | null,
  next: ContextAssertRecord,
): string | null {
  if (!prev) return null;
  if (prev.generation !== next.generation) return null;
  if (prev.prefixHash === next.prefixHash && prev.prefixCount === next.prefixCount) return null;
  const what =
    prev.prefixCount !== next.prefixCount
      ? `前缀条数 ${prev.prefixCount} → ${next.prefixCount}`
      : `前缀内容变了（${prev.prefixHash} → ${next.prefixHash}）`;
  return (
    `上下文稳定前缀在没有压缩的情况下变了：${what}。` +
    `这会作废厂商侧的 prompt cache，也说明某条历史被就地改写了。` +
    `（generation=${next.generation}，整包 ${prev.total} → ${next.total} 条）`
  );
}
