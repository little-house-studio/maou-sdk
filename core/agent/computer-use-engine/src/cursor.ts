/** 每个 agent 会话一把虚拟光标；桌面动作串行，避免抢系统指针。 */

export type DesktopOwner = {
  id: string;
  label: string;
  color: string;
  x?: number;
  y?: number;
};

const COLORS = ["#5B8DEF", "#E6A23C", "#67C23A", "#F56C6C", "#9B59B6", "#00B4D8"];

const pointers = new Map<string, DesktopOwner>();
let lock: Promise<void> = Promise.resolve();

export function desktopOwnerFrom(agentName?: string, sessionId?: string): DesktopOwner {
  const label = (agentName || "agent").trim() || "agent";
  const sid = (sessionId || "session").trim() || "session";
  const id = `${label}:${sid}`;
  const prev = pointers.get(id);
  if (prev) return prev;
  const owner: DesktopOwner = { id, label, color: colorFor(id) };
  pointers.set(id, owner);
  return owner;
}

export function rememberPointer(owner: DesktopOwner, x?: number, y?: number): DesktopOwner {
  const next = {
    ...owner,
    ...(x != null && Number.isFinite(x) ? { x } : {}),
    ...(y != null && Number.isFinite(y) ? { y } : {}),
  };
  pointers.set(owner.id, next);
  return next;
}

export function recallPointer(ownerId: string): DesktopOwner | undefined {
  return pointers.get(ownerId);
}

export async function withDesktopLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const prev = lock;
  lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

export function resetCursorsForTest(): void {
  pointers.clear();
  lock = Promise.resolve();
}
