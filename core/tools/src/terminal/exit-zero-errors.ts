/**
 * exit 0 但合并输出里有明显错误行：给模型看的 warning，不改 ok。
 */

export type ExitZeroWarning = {
  count: number;
  samples: string[];
};

const STRONG_RE = /\bERROR\b|❌/i;
const WEAK_RE =
  /\b(?:failed|failure|fatal)\b|(?:^|\s)cp:|No such file|\bcannot\s+/i;
const NOISE_RE =
  /(?:^|\s)npm\s+warn\b|rustc\s+warning|\bdeprecated\b|^\s*warning:/i;

const SAMPLE_LIMIT = 8;
const WEAK_LINE_THRESHOLD = 3;

function isNoiseLine(line: string): boolean {
  if (STRONG_RE.test(line)) return false;
  return NOISE_RE.test(line);
}

function isErrorLine(line: string): boolean {
  return STRONG_RE.test(line) || WEAK_RE.test(line);
}

/** exit_code===0 时扫合并输出；非 0 不走这条。 */
export function detectExitZeroWarning(
  output: string,
  exitCode: number | null | undefined,
): ExitZeroWarning | null {
  if (exitCode !== 0) return null;
  if (!output) return null;

  const hits: string[] = [];
  let strong = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim() || isNoiseLine(line) || !isErrorLine(line)) continue;
    hits.push(line);
    if (STRONG_RE.test(line)) strong++;
  }
  if (strong < 1 && hits.length < WEAK_LINE_THRESHOLD) return null;
  return { count: hits.length, samples: hits.slice(0, SAMPLE_LIMIT) };
}

export function formatExitZeroWarning(hit: ExitZeroWarning): string {
  return `⚠ [warning] 退出码 0，输出含 ${hit.count} 行错误迹象：\n${hit.samples.join("\n")}`;
}

export function applyExitZeroWarning(
  body: string,
  meta: Record<string, unknown>,
  payload: Record<string, unknown>,
  output: string,
  exitCode: number | null | undefined,
): { body: string; meta: Record<string, unknown>; payload: Record<string, unknown> } {
  const hit = detectExitZeroWarning(output, exitCode);
  if (!hit) return { body, meta, payload };
  return {
    body: `${formatExitZeroWarning(hit)}\n\n${body}`,
    meta: { ...meta, warning: true },
    payload: { ...payload, warning: true },
  };
}
