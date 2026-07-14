/**
 * 滚动速度自适应 + commit 预算。
 *
 * 目标：ink 提交 ≈ paint 完成 ≈ 25fps，而不是 ink 27、paint 15 空转。
 * Grok 式思路：滚轮事件合并 + 限频应用 offset，每帧跳更多行。
 */

/** 最近窗内滚轮事件计数 */
let burst = 0;
let lastTs = 0;
let decayTimer: ReturnType<typeof setTimeout> | null = null;

const DECAY_MS = 100;

/** 记一次滚轮（触控板/鼠标） */
export function noteScrollWheel(): void {
  const now = Date.now();
  if (now - lastTs > 140) burst = 0;
  lastTs = now;
  burst += 1;
  if (decayTimer) clearTimeout(decayTimer);
  decayTimer = setTimeout(() => {
    burst = Math.max(0, burst - 6);
    decayTimer = null;
  }, DECAY_MS);
}

/** 0=慢 1=中 2=快 */
export function scrollPaceLevel(): 0 | 1 | 2 {
  if (burst >= 14) return 2;
  if (burst >= 6) return 1;
  return 0;
}

/**
 * store 合帧等待（ms）——仅「攒 delta」的短窗；
 * 真正限频见 scrollCommitMinMs。
 */
export function scrollCoalesceMs(baseMs: number): number {
  const lv = scrollPaceLevel();
  if (lv >= 2) return Math.max(baseMs, 12);
  if (lv >= 1) return Math.max(baseMs, 10);
  return baseMs;
}

/**
 * 两次 applyChatScrollDelta（→ React/Ink commit）最小间隔。
 * 40ms ≈ 25 commit/s：与目标 25fps 对齐，避免 ink 堆积、paint 跟不上。
 * MAOU_SCROLL_COMMIT_MS 可覆盖。
 */
export function scrollCommitMinMs(): number {
  const raw = process.env.MAOU_SCROLL_COMMIT_MS;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.min(100, Math.max(0, Math.round(n)));
  }
  const lv = scrollPaceLevel();
  // 慢滑更密一点跟手；快滑略稀 + 更大步长
  if (lv >= 2) return 40; // 25/s
  if (lv >= 1) return 36; // ~28/s
  return 32; // ~31/s
}

/**
 * 滚动中 paint 延迟：与 commit 间隔同量级，避免「ink 多、paint 少」。
 */
export function scrollPaintMs(baseMs: number): number {
  const commit = scrollCommitMinMs();
  // paint 略短于 commit，保证每次 commit 都能画到
  const aligned = Math.max(12, commit - 4);
  const lv = scrollPaceLevel();
  if (lv >= 2) return Math.max(baseMs, aligned);
  if (lv >= 1) return Math.max(baseMs, Math.min(aligned, 28));
  return Math.min(baseMs, aligned);
}

/**
 * 每次滚轮事件累计行数。
 * 快滑 + 限频时步长加大，总位移不丢。
 */
export function scrollWheelLines(): number {
  const lv = scrollPaceLevel();
  if (lv >= 2) return 4;
  if (lv >= 1) return 2;
  return 1;
}
