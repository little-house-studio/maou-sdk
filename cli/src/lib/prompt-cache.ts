/**
 * CLI 侧 prompt-cache 展示适配。
 *
 * 权威分桶在 agent 层 PromptCacheLedger（agentName + sessionId + mainModel）。
 * 本文件只做：
 *   - re-export agent 判定函数（兼容旧 import）
 *   - 把 CacheSnapshot 转成 UI 用的 cacheHistory / label
 *   - 从 ledger 拉当前前台桶（切 agent/会话时恢复）
 */

import {
  PromptCacheLedger,
  promptCacheLedger,
  modelReportsPromptCache,
  normalizeModelId,
  isMainAgentMainModelUsage,
  avgCacheHitPct,
  type CacheSnapshot,
  type CacheSample,
} from "@little-house-studio/agent";

export {
  PromptCacheLedger,
  promptCacheLedger,
  modelReportsPromptCache,
  normalizeModelId,
  isMainAgentMainModelUsage,
  avgCacheHitPct,
};
export type { CacheSnapshot, CacheSample };

/** 从 agent 分桶快照得到 UI 标签 */
export function formatCacheLabel(
  model: string | undefined | null,
  provider: string | undefined | null,
  history: Array<{ cacheRead: number; input: number }>,
  lastN = 10,
): { label: string; pct: number | null; eligible: boolean } {
  const eligible = modelReportsPromptCache(model, provider);
  if (!eligible) return { label: " c—", pct: null, eligible: false };
  const pct = avgCacheHitPct(history, lastN);
  if (pct === null) return { label: " c—", pct: null, eligible: true };
  return { label: ` c${pct}%`, pct, eligible: true };
}

/** 从完整 snapshot 格式化（优先用 agent 层已算好的 label） */
export function formatCacheLabelFromSnap(snap: CacheSnapshot | null | undefined): {
  label: string;
  pct: number | null;
  eligible: boolean;
  samples: CacheSample[];
} {
  if (!snap) {
    return { label: " c—", pct: null, eligible: false, samples: [] };
  }
  return {
    label: snap.label,
    pct: snap.avgHitPct,
    // 「可能上报」不等于「真上报」——两者都成立才按有缓存能力上色
    eligible: snap.reportsCache && snap.sawCacheField,
    samples: snap.samples,
  };
}

/**
 * 切 agent / 会话 / 模型时：从 agent 层 ledger 恢复当前桶到 UI 可镜像的 samples。
 */
export function loadCacheHistoryFromLedger(
  agentName: string,
  sessionId: string | null | undefined,
  model: string,
): { cacheHistory: CacheStatMirror[]; snapshot: CacheSnapshot } {
  const snap = promptCacheLedger().snapshot(agentName, sessionId ?? "", model);
  // 与 ledger.toSnapshot 一致：含未 seal 的 current，避免切回会话时 c— 直到下一轮 seal
  const samples = [...snap.samples];
  if (
    snap.reportsCache &&
    snap.sawCacheField &&
    (snap.current.input > 0 || snap.current.cacheRead > 0)
  ) {
    samples.push({
      cacheRead: snap.current.cacheRead,
      input: snap.current.input,
      cacheWrite: snap.current.cacheWrite ?? 0,
      model: snap.model,
      ts: Date.now(),
    });
  }
  return { snapshot: snap, cacheHistory: mirrorSamples(samples) };
}

/** UI 侧镜像的样本形状（与 state/types.ts 的 CacheStat 对齐） */
type CacheStatMirror = {
  cacheRead: number;
  input: number;
  cacheWrite?: number;
  model?: string;
};

function mirrorSamples(samples: CacheSample[]): CacheStatMirror[] {
  return samples.map((s) => ({
    cacheRead: s.cacheRead ?? 0,
    input: s.input ?? 0,
    cacheWrite: s.cacheWrite ?? 0,
    model: s.model,
  }));
}

/** 从 stream 事件上的 cache 字段镜像 UI history（含未 seal current，若事件带了） */
export function cacheHistoryFromEventCache(cache: unknown): CacheStatMirror[] | null {
  if (!cache || typeof cache !== "object") return null;
  const snap = cache as CacheSnapshot;
  if (!Array.isArray(snap.samples)) return null;
  const samples = [...snap.samples];
  const cur = snap.current;
  if (
    cur &&
    snap.reportsCache &&
    snap.sawCacheField &&
    ((cur.input ?? 0) > 0 || (cur.cacheRead ?? 0) > 0)
  ) {
    samples.push({
      cacheRead: cur.cacheRead ?? 0,
      input: cur.input ?? 0,
      cacheWrite: cur.cacheWrite ?? 0,
      model: snap.model,
      ts: Date.now(),
    });
  }
  return mirrorSamples(samples);
}
