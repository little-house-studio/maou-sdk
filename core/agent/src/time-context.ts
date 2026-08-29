/**
 * 可选时钟快照 + 真复用器窗格。默认不注入。
 */

export interface TimeContextOpts {
  enabled?: boolean;
  minIntervalMs?: number;
}

export interface TimeSnapshot {
  iso: string;
  timeZone: string;
  tzConflict: boolean;
  elapsedMs: number | null;
  text: string;
}

const IDE_TERM_PROGRAMS = new Set([
  "vscode",
  "vscode-insiders",
  "cursor",
  "antigravity",
  "electron",
  "apple_terminal",
]);

export function hostTimeZone(env: NodeJS.ProcessEnv = process.env): {
  zone: string;
  tzConflict: boolean;
} {
  let system = "UTC";
  try {
    system = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    system = "UTC";
  }
  const tz = (env.TZ ?? "").trim();
  if (!tz) return { zone: system, tzConflict: false };
  if (tz === system) return { zone: system, tzConflict: false };
  return { zone: system, tzConflict: true };
}

export function formatOffset(date: Date): string {
  const mins = -date.getTimezoneOffset();
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `GMT${sign}${hh}:${mm}`;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function compileTimeSnapshot(opts: {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  previousAt?: number | null;
  turn?: number;
  step?: number;
}): TimeSnapshot {
  const now = opts.now ?? new Date();
  const { zone, tzConflict } = hostTimeZone(opts.env);
  const elapsedMs =
    typeof opts.previousAt === "number" ? Math.max(0, now.getTime() - opts.previousAt) : null;
  const iso = `${now.toISOString().replace(/\.\d+Z$/, "")}${formatOffset(now)}[${zone}]`;
  const lines = [
    "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.",
    `Time sampled while preparing turn ${opts.turn ?? 1}, step ${opts.step ?? 1}: ${iso}`,
    `Browser time zone for this request: ${zone}. Interpret otherwise-unqualified dates and times in this zone.`,
  ];
  if (elapsedMs != null) {
    lines.push(`Elapsed since the preceding step: ${formatElapsed(elapsedMs)}.`);
  }
  if (tzConflict) {
    lines.push(
      `TZ=${(opts.env ?? process.env).TZ} differs from host zone ${zone}. Ask the user which zone to use.`,
    );
  }
  return {
    iso,
    timeZone: zone,
    tzConflict,
    elapsedMs,
    text: `<time_context>\n${lines.join("\n")}\n</time_context>`,
  };
}

export class TimeContextGate {
  private lastText = "";
  private lastAt = 0;

  constructor(private readonly opts: TimeContextOpts) {}

  get enabled(): boolean {
    return this.opts.enabled === true;
  }

  consume(meta?: { turn?: number; step?: number; now?: Date; env?: NodeJS.ProcessEnv }): string {
    if (!this.enabled) return "";
    const min = this.opts.minIntervalMs ?? 5 * 60 * 1000;
    const now = meta?.now ?? new Date();
    if (this.lastAt && now.getTime() - this.lastAt < min) return "";
    const snap = compileTimeSnapshot({
      now,
      env: meta?.env,
      previousAt: this.lastAt || null,
      turn: meta?.turn,
      step: meta?.step,
    });
    if (snap.text === this.lastText) return "";
    this.lastText = snap.text;
    this.lastAt = now.getTime();
    return snap.text;
  }
}

const DYNAMIC_SUPERSEDES_LINE =
  "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.";
const DYNAMIC_CLEARED_LINE =
  "Current runtime context: none. Earlier runtime-context snapshots no longer apply.";

/**
 * 每轮重算的运行时快照（终端列表、活动进程之类）。
 *
 * 三件事缺一不可：
 * - 内容变了才注入，否则同一份状态在历史里堆几十遍；
 * - 注入时带 supersedes 头，模型才知道旧快照作废；
 * - 由非空变空时要说出来，否则模型会一直用最后见过的那份。
 */
export class DynamicSnapshotGate {
  private lastBody = "";

  consume(body: string): string {
    const next = (body ?? "").trim();
    if (!next) {
      if (!this.lastBody) return "";
      this.lastBody = "";
      return `<runtime_context>\n${DYNAMIC_CLEARED_LINE}\n</runtime_context>`;
    }
    if (next === this.lastBody) return "";
    this.lastBody = next;
    return `<runtime_context>\n${DYNAMIC_SUPERSEDES_LINE}\n${next}\n</runtime_context>`;
  }

  reset(): void {
    this.lastBody = "";
  }
}

export function looksLikeIdeTerm(env: NodeJS.ProcessEnv = process.env): boolean {
  const prog = (env.TERM_PROGRAM ?? "").trim().toLowerCase();
  return IDE_TERM_PROGRAMS.has(prog);
}

/**
 * 只有真的开在 tmux/screen 里才报窗格。
 * 编辑器残留的 TMUX_PANE 不信。
 */
export function detectMultiplexerPane(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { queryTmux?: (env: NodeJS.ProcessEnv) => string | null },
): { kind: "tmux" | "screen"; pane: string } | null {
  if (looksLikeIdeTerm(env)) return null;
  const tmux = (env.TMUX ?? "").trim();
  const pane = (env.TMUX_PANE ?? "").trim();
  const sty = (env.STY ?? "").trim();
  if (tmux) {
    const queried = opts?.queryTmux?.(env) ?? null;
    if (queried) return { kind: "tmux", pane: queried };
    if (pane && tmux.includes(pane.replace(/^%/, ""))) {
      return { kind: "tmux", pane };
    }
    if (pane && /^%\d+$/.test(pane) && tmux.split(",").length >= 2) {
      return { kind: "tmux", pane };
    }
    return null;
  }
  if (sty && !looksLikeIdeTerm(env)) {
    const win = (env.WINDOW ?? "").trim();
    return { kind: "screen", pane: win || sty };
  }
  return null;
}

export function formatMultiplexerPane(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { queryTmux?: (env: NodeJS.ProcessEnv) => string | null },
): string {
  const hit = detectMultiplexerPane(env, opts);
  if (!hit) return "";
  return `<multiplexer_pane kind="${hit.kind}">${hit.pane}</multiplexer_pane>`;
}
