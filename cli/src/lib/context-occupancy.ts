/**
 * 上下文占用：上一条回报的 input + output。无 usage 则为 0。
 */

export type OccupancyParts = { input: number; output: number };

export function occupancyFromParts(
  input?: number | null,
  output?: number | null,
): number {
  const inn = Number.isFinite(input) && (input ?? 0) > 0 ? Math.trunc(input as number) : 0;
  const out = Number.isFinite(output) && (output ?? 0) > 0 ? Math.trunc(output as number) : 0;
  return inn + out;
}

export function lastOccupancyFromMessages(
  messages: Array<{ usage?: { input?: number; output?: number } | null }>,
): OccupancyParts | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const u = messages[i]?.usage;
    if (!u) continue;
    const input = occupancyFromParts(u.input, 0);
    const output = occupancyFromParts(0, u.output);
    if (input > 0 || output > 0) return { input: u.input ?? 0, output: u.output ?? 0 };
  }
  return null;
}

export function occupancyFromState(s: {
  lastOccupancy?: OccupancyParts | null;
  messages?: Array<{ usage?: { input?: number; output?: number } | null }>;
}): number {
  const last = s.lastOccupancy;
  if (last && (last.input > 0 || last.output > 0)) {
    return occupancyFromParts(last.input, last.output);
  }
  return 0;
}
