/**
 * CLI-aligned “↑ 上一条 user” jump helpers.
 * Port of cli/src/render/scroll-math.ts + prev_user_jump_label / jump_prev_user.
 */

/** CLI: show_jump when !empty && scroll_from_bottom > 2 (row units). Web: px threshold. */
export const JUMP_SHOW_FROM_BOTTOM_PX = 24;

export function shouldShowJumpBar(
  empty: boolean,
  scrollFromBottomPx: number,
): boolean {
  if (empty) return false;
  return scrollFromBottomPx > JUMP_SHOW_FROM_BOTTOM_PX;
}

export function shouldShowBackToBottom(
  empty: boolean,
  scrollFromBottomPx: number,
): boolean {
  if (empty) return false;
  return scrollFromBottomPx > 2;
}

/**
 * Viewport top contentY 之上、完全不可见的最近一条 user。
 * isUser / starts / heights 与 CLI findOlderUserIndex 同语义。
 */
export function findOlderUserIndex(
  isUser: boolean[],
  starts: number[],
  heights: number[],
  contentTopY: number,
): number {
  let last = -1;
  const top = Math.round(contentTopY);
  for (let i = 0; i < isUser.length; i++) {
    const y0 = starts[i] ?? 0;
    const h = heights[i] ?? 0;
    const y1 = y0 + h;
    if (y1 <= top) {
      if (isUser[i]) last = i;
      continue;
    }
    break;
  }
  return last;
}

/** Align contentY=targetY to viewport top → scrollTop for top-anchored layout. */
export function scrollTopToAlignMessage(
  targetOffsetTop: number,
  maxScrollTop: number,
): number {
  const y = Math.max(0, Math.round(targetOffsetTop));
  const max = Math.max(0, Math.round(maxScrollTop));
  return Math.max(0, Math.min(max, y));
}

/**
 * Ink older bar label: `↑ ` + preview of previous user body.
 * Falls back to 「↑ 上一条 user（点击）」 when no preview.
 */
export function buildPrevUserJumpLabel(
  body: string | null | undefined,
  maxChars = 48,
): string {
  const cleaned = (body ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "↑ 上一条 user（点击）";
  const budget = Math.max(8, maxChars);
  if (cleaned.length <= budget) return `↑ ${cleaned}`;
  return `↑ ${cleaned.slice(0, budget - 1)}…`;
}

export type UserLayoutEntry = {
  id: string;
  body: string;
  /** offsetTop relative to scroll content */
  top: number;
  height: number;
};

/**
 * From measured user rows + scrollTop, pick older user for jump bar.
 * Returns null if none fully above viewport top.
 */
export function pickOlderUser(
  users: UserLayoutEntry[],
  scrollTop: number,
): UserLayoutEntry | null {
  if (users.length === 0) return null;
  const isUser = users.map(() => true);
  const starts = users.map((u) => u.top);
  const heights = users.map((u) => u.height);
  const idx = findOlderUserIndex(isUser, starts, heights, scrollTop);
  if (idx < 0) return null;
  return users[idx] ?? null;
}

export function measureScrollFromBottom(el: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

/**
 * Whether the viewport is "glued" to the live tail.
 * Slightly looser than jump-bar hide so new messages keep pinning down
 * while the user is still near the bottom.
 */
export const STICK_TO_BOTTOM_PX = 64;

export function shouldStickToBottom(
  scrollFromBottomPx: number,
  thresholdPx: number = STICK_TO_BOTTOM_PX,
): boolean {
  return scrollFromBottomPx <= thresholdPx;
}
