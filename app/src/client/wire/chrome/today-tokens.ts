/** 顶栏今日 in/out 文案。WireTopbar 读；live-state / draft-state 写数字。 */

export function localDayKey(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function compactScaled(n: number, suffix: string): string {
  const s = n >= 10 ? n.toFixed(0) : n.toFixed(1);
  return `${s.replace(/\.0$/, "")}${suffix}`;
}

export function formatCompactTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const abs = Math.round(n);
  if (abs < 1_000) return String(abs);
  if (abs < 1_000_000) return compactScaled(abs / 1_000, "K");
  if (abs < 1_000_000_000) return compactScaled(abs / 1_000_000, "M");
  return compactScaled(abs / 1_000_000_000, "B");
}

export function formatTodayTokenTitle(input: number, output: number): string {
  const inn = Number.isFinite(input) && input > 0 ? Math.round(input) : 0;
  const out = Number.isFinite(output) && output > 0 ? Math.round(output) : 0;
  return `今日输入 ${inn.toLocaleString()} · 输出 ${out.toLocaleString()}`;
}

export function formatTodayInArrow(input: number): string {
  return `↑ ${formatCompactTokenCount(input)}`;
}

export function formatTodayOutArrow(output: number): string {
  return `↓ ${formatCompactTokenCount(output)}`;
}
