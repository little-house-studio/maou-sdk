/** 顶栏今日 in/out 文案。WireTopbar 读；live-state / draft-state 写数字。 */

export function localDayKey(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function formatCompactTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const abs = Math.round(n);
  if (abs < 1000) return String(abs);
  if (abs < 1_000_000) {
    const k = abs / 1000;
    const s = k >= 10 ? k.toFixed(0) : k.toFixed(1);
    return `${s.replace(/\.0$/, "")}k`;
  }
  const m = abs / 1_000_000;
  const s = m >= 10 ? m.toFixed(0) : m.toFixed(1);
  return `${s.replace(/\.0$/, "")}m`;
}

export function formatTodayTokenTitle(input: number, output: number): string {
  const inn = Number.isFinite(input) && input > 0 ? Math.round(input) : 0;
  const out = Number.isFinite(output) && output > 0 ? Math.round(output) : 0;
  return `今日输入 ${inn.toLocaleString()} · 输出 ${out.toLocaleString()}`;
}

/** 顶栏一行：今日 1.2k / 500 */
export function formatTodayTokenLine(input: number, output: number): string {
  return `今日 ${formatCompactTokenCount(input)} / ${formatCompactTokenCount(output)}`;
}
