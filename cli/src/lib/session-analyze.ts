/**
 * Session 诊断 —— 从 .maou/sessions/<id>.jsonl 生成逐步 timeline。
 *
 * 对齐 Harness 优化计划 P0：
 *   - 每步 purpose / tool / tokens / cache_read
 *   - cache 断点（cache_read 从有变 0）
 *   - 启发式浪费标注（仅提示，不自动改 skill）
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { projectSessionFile, projectSessionsDir, projectMaouRoot } from "../config/paths.js";

// ── types ──────────────────────────────────────────────────────────────────

export type WasteFlag = "n" | "p" | "y";
/** n=正常 · p=可疑 · y=疑似浪费 */

export interface AnalyzeStep {
  index: number;
  round?: number;
  kind: "assistant" | "tool" | "user" | "other";
  purpose: string;
  toolName?: string;
  toolOk?: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  /** cache 命中率 0–1；无 input 时为 null */
  cacheHitRate: number | null;
  /** 相对上一步：cache_read 从 >0 变为 0 */
  cacheBreak: boolean;
  waste: WasteFlag;
  wasteReason?: string;
  createdAt?: string;
  /** 工具参数摘要（截断） */
  argsPreview?: string;
}

export interface SessionAnalyzeReport {
  sessionId: string;
  sessionFile: string;
  steps: AnalyzeStep[];
  summary: {
    totalSteps: number;
    assistantTurns: number;
    toolCalls: number;
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    cacheBreaks: number;
    wasteY: number;
    wasteP: number;
    avgCacheHitRate: number | null;
  };
}

// ── parse helpers ──────────────────────────────────────────────────────────

function parseUsage(raw: unknown): { input: number; output: number; cacheRead: number } {
  if (!raw || typeof raw !== "object") return { input: 0, output: 0, cacheRead: 0 };
  const u = raw as Record<string, unknown>;
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
  const details = u.prompt_tokens_details as { cached_tokens?: number } | undefined;
  const cacheRead =
    Number(
      u.cached_tokens ??
        u.cache_read_input_tokens ??
        u.cache_hit_tokens ??
        details?.cached_tokens ??
        0,
    ) || 0;
  return { input, output, cacheRead };
}

function toolNameFromCall(tc: Record<string, unknown>): string {
  const fn = tc.function as { name?: string } | undefined;
  return String(tc.name ?? fn?.name ?? "tool");
}

function argsPreviewFromCall(tc: Record<string, unknown>, max = 80): string {
  const params =
    tc.parameters ??
    tc.arguments ??
    (tc.function as { arguments?: unknown } | undefined)?.arguments;
  let s: string;
  if (params == null) s = "";
  else if (typeof params === "string") s = params;
  else {
    try {
      s = JSON.stringify(params);
    } catch {
      s = String(params);
    }
  }
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) return s.slice(0, max - 1) + "…";
  return s;
}

function fingerprintTool(name: string, args: string): string {
  // 粗粒度：名字 + 参数前 120 字符（用于连续重复检测）
  return `${name}::${args.slice(0, 120)}`;
}

// ── core analyze ───────────────────────────────────────────────────────────

/** 从 jsonl 文本分析（可单测） */
export function analyzeSessionJsonl(sessionId: string, raw: string, sessionFile = ""): SessionAnalyzeReport {
  const lines = raw.split("\n").filter((l) => l.trim());
  const steps: AnalyzeStep[] = [];
  let prevCacheRead: number | null = null;
  let prevToolFp: string | null = null;
  let consecutiveSame = 0;

  for (const line of lines) {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = String(ev.type ?? "message");
    const role = String(ev.role ?? "");
    const round =
      typeof ev.round === "number"
        ? ev.round
        : typeof ev.round === "string"
          ? parseInt(ev.round, 10) || undefined
          : undefined;
    const createdAt = typeof ev.createdAt === "string"
      ? ev.createdAt
      : typeof ev.created_at === "string"
        ? ev.created_at
        : undefined;

    // raw tool_call / tool_result 条目（部分 session 会写）
    if (type === "tool_call") {
      const data = (ev.data ?? {}) as Record<string, unknown>;
      const name = String(data.name ?? "tool");
      const args = argsPreviewFromCall(data);
      const fp = fingerprintTool(name, args);
      if (fp === prevToolFp) consecutiveSame++;
      else {
        consecutiveSame = 1;
        prevToolFp = fp;
      }
      let waste: WasteFlag = "n";
      let wasteReason: string | undefined;
      if (consecutiveSame >= 3) {
        waste = "y";
        wasteReason = `连续 ${consecutiveSame} 次相同工具+参数`;
      }
      steps.push({
        index: steps.length + 1,
        round,
        kind: "tool",
        purpose: `tool_call ${name}`,
        toolName: name,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheHitRate: null,
        cacheBreak: false,
        waste,
        wasteReason,
        createdAt,
        argsPreview: args || undefined,
      });
      continue;
    }

    if (type !== "message") continue;

    if (role === "user") {
      const content = String(ev.content ?? "").slice(0, 60).replace(/\s+/g, " ");
      steps.push({
        index: steps.length + 1,
        round,
        kind: "user",
        purpose: content ? `user: ${content}` : "user",
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheHitRate: null,
        cacheBreak: false,
        waste: "n",
        createdAt,
      });
      continue;
    }

    if (role === "assistant") {
      const usage = parseUsage(ev.usage);
      const cacheBreak =
        prevCacheRead != null && prevCacheRead > 0 && usage.cacheRead === 0 && usage.input > 0;
      if (usage.input > 0 || usage.cacheRead > 0) {
        prevCacheRead = usage.cacheRead;
      }
      const hitRate =
        usage.input > 0 ? Math.min(1, usage.cacheRead / usage.input) : null;

      const calls = (ev.toolCalls ?? ev.native_tool_calls ?? []) as Array<Record<string, unknown>>;
      const toolNames = calls.map(toolNameFromCall).filter(Boolean);
      const content = String(ev.content ?? "").trim();
      let purpose: string;
      if (toolNames.length > 0) {
        purpose = `assistant → ${toolNames.join(", ")}`;
      } else if (content) {
        purpose = `assistant 回复 (${Math.min(content.length, 40)}字)`;
      } else {
        purpose = "assistant";
      }

      let waste: WasteFlag = "n";
      let wasteReason: string | undefined;
      if (cacheBreak) {
        waste = "p";
        wasteReason = "cache 断点（cache_read 从有变 0）";
      } else if (hitRate != null && hitRate < 0.05 && usage.input >= 4000) {
        waste = "p";
        wasteReason = "大 prompt 几乎未命中 cache";
      }

      // 每个 tool call 拆成子步骤（带参数指纹）
      if (calls.length === 0) {
        steps.push({
          index: steps.length + 1,
          round,
          kind: "assistant",
          purpose,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheRead: usage.cacheRead,
          cacheHitRate: hitRate,
          cacheBreak,
          waste,
          wasteReason,
          createdAt,
        });
      } else {
        // 先记 assistant 用量一步
        steps.push({
          index: steps.length + 1,
          round,
          kind: "assistant",
          purpose,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheRead: usage.cacheRead,
          cacheHitRate: hitRate,
          cacheBreak,
          waste,
          wasteReason,
          createdAt,
        });
        for (const tc of calls) {
          const name = toolNameFromCall(tc);
          const args = argsPreviewFromCall(tc);
          const fp = fingerprintTool(name, args);
          if (fp === prevToolFp) consecutiveSame++;
          else {
            consecutiveSame = 1;
            prevToolFp = fp;
          }
          let tw: WasteFlag = "n";
          let tr: string | undefined;
          if (consecutiveSame >= 3) {
            tw = "y";
            tr = `连续 ${consecutiveSame} 次相同工具+参数`;
          }
          steps.push({
            index: steps.length + 1,
            round,
            kind: "tool",
            purpose: `call ${name}`,
            toolName: name,
            inputTokens: 0,
            outputTokens: 0,
            cacheRead: 0,
            cacheHitRate: null,
            cacheBreak: false,
            waste: tw,
            wasteReason: tr,
            createdAt,
            argsPreview: args || undefined,
          });
        }
      }
      continue;
    }

    if (role === "tool") {
      const name = String(ev.tool_name ?? "tool");
      const okRaw = ev.tool_ok ?? ev.ok ?? ev.success;
      const toolOk =
        okRaw === false || okRaw === "false" || okRaw === 0 || okRaw === "0"
          ? false
          : okRaw === true || okRaw === "true" || okRaw === 1 || okRaw === "1"
            ? true
            : undefined;
      const content = String(ev.content ?? "");
      let waste: WasteFlag = "n";
      let wasteReason: string | undefined;
      if (toolOk === false) {
        waste = "p";
        wasteReason = "工具返回失败";
      } else if (/找不到|not found|no such file|ENOENT|失败|error/i.test(content.slice(0, 200))) {
        waste = "p";
        wasteReason = "结果疑似失败/空";
      }
      // 参数预览：若有 tool_parameters
      const args = argsPreviewFromCall({
        parameters: ev.tool_parameters,
      });
      steps.push({
        index: steps.length + 1,
        round,
        kind: "tool",
        purpose: `result ${name}${toolOk === false ? " ✗" : ""}`,
        toolName: name,
        toolOk,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheHitRate: null,
        cacheBreak: false,
        waste,
        wasteReason,
        createdAt,
        argsPreview: args || undefined,
      });
    }
  }

  // 汇总
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let cacheBreaks = 0;
  let wasteY = 0;
  let wasteP = 0;
  let assistantTurns = 0;
  let toolCalls = 0;
  let hitSum = 0;
  let hitN = 0;

  for (const s of steps) {
    totalInput += s.inputTokens;
    totalOutput += s.outputTokens;
    totalCacheRead += s.cacheRead;
    if (s.cacheBreak) cacheBreaks++;
    if (s.waste === "y") wasteY++;
    if (s.waste === "p") wasteP++;
    if (s.kind === "assistant") assistantTurns++;
    if (s.kind === "tool" && s.purpose.startsWith("call ")) toolCalls++;
    if (s.cacheHitRate != null) {
      hitSum += s.cacheHitRate;
      hitN++;
    }
  }

  return {
    sessionId,
    sessionFile,
    steps,
    summary: {
      totalSteps: steps.length,
      assistantTurns,
      toolCalls,
      totalInput,
      totalOutput,
      totalCacheRead,
      cacheBreaks,
      wasteY,
      wasteP,
      avgCacheHitRate: hitN > 0 ? hitSum / hitN : null,
    },
  };
}

/** 解析磁盘上的 session 文件 */
export function analyzeSessionFile(sessionId: string, cwd = process.cwd()): SessionAnalyzeReport {
  const file = projectSessionFile(sessionId, cwd);
  if (!existsSync(file)) {
    throw new Error(`会话文件不存在: ${file}`);
  }
  const raw = readFileSync(file, "utf-8");
  return analyzeSessionJsonl(sessionId, raw, file);
}

/** 解析最近一次会话（last-session 或 mtime 最新 jsonl） */
export function resolveLatestSessionId(cwd = process.cwd()): string | null {
  const lastPath = join(projectMaouRoot(cwd), "last-session.json");
  if (existsSync(lastPath)) {
    try {
      const j = JSON.parse(readFileSync(lastPath, "utf-8")) as { sessionId?: string };
      if (j.sessionId && existsSync(projectSessionFile(j.sessionId, cwd))) {
        return j.sessionId;
      }
    } catch {
      /* ignore */
    }
  }
  const dir = projectSessionsDir(cwd);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      id: f.replace(/\.jsonl$/, ""),
      mtime: statSync(join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.id ?? null;
}

// ── format ─────────────────────────────────────────────────────────────────

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function pct(r: number | null): string {
  if (r == null) return "—";
  return `${(r * 100).toFixed(0)}%`;
}

/** Markdown 报告 */
export function formatAnalyzeMarkdown(report: SessionAnalyzeReport): string {
  const s = report.summary;
  const lines: string[] = [
    `# Session 诊断 · ${report.sessionId}`,
    "",
    `- 文件: \`${report.sessionFile || "(in-memory)"}\``,
    `- 步数: **${s.totalSteps}**（assistant ${s.assistantTurns} · tool calls ${s.toolCalls}）`,
    `- tokens: input **${fmtK(s.totalInput)}** · output **${fmtK(s.totalOutput)}** · cache_read **${fmtK(s.totalCacheRead)}**`,
    `- cache 断点: **${s.cacheBreaks}** · 平均命中率: **${pct(s.avgCacheHitRate)}**`,
    `- 浪费标注: Y(疑似浪费)=**${s.wasteY}** · P(可疑)=**${s.wasteP}** · 其余 N(正常)`,
    "",
    "> 标注仅为启发式提示，不会自动改 skill。Y/P 需人工确认。",
    "",
    "| # | rd | flag | purpose | in | out | cache | hit | note |",
    "|---:|---:|:---:|---------|---:|----:|------:|----:|------|",
  ];

  for (const st of report.steps) {
    const flag = st.cacheBreak ? "⚡" + st.waste.toUpperCase() : st.waste.toUpperCase();
    const purpose = (st.purpose + (st.argsPreview ? ` \`${st.argsPreview}\`` : "")).replace(/\|/g, "\\|");
    const note = (st.wasteReason ?? (st.cacheBreak ? "cache break" : "")).replace(/\|/g, "\\|");
    lines.push(
      `| ${st.index} | ${st.round ?? "—"} | ${flag} | ${purpose} | ${st.inputTokens ? fmtK(st.inputTokens) : "—"} | ${st.outputTokens ? fmtK(st.outputTokens) : "—"} | ${st.cacheRead ? fmtK(st.cacheRead) : "—"} | ${pct(st.cacheHitRate)} | ${note} |`,
    );
  }

  lines.push("");
  if (s.cacheBreaks > 0) {
    lines.push("## Cache 断点");
    lines.push("");
    for (const st of report.steps.filter((x) => x.cacheBreak)) {
      lines.push(`- 步骤 #${st.index}（round ${st.round ?? "?"}）: ${st.purpose}`);
    }
    lines.push("");
  }
  if (s.wasteY + s.wasteP > 0) {
    lines.push("## 可疑 / 浪费步骤");
    lines.push("");
    for (const st of report.steps.filter((x) => x.waste !== "n")) {
      lines.push(`- **${st.waste.toUpperCase()}** #${st.index}: ${st.purpose}${st.wasteReason ? ` — ${st.wasteReason}` : ""}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("*生成: maou session analyze*");
  return lines.join("\n");
}

/** 终端纯文本简表（窄屏友好） */
export function formatAnalyzeText(report: SessionAnalyzeReport): string {
  const s = report.summary;
  const out: string[] = [];
  out.push(`Session ${report.sessionId}`);
  out.push(
    `steps=${s.totalSteps} assistant=${s.assistantTurns} tools=${s.toolCalls}  in=${fmtK(s.totalInput)} out=${fmtK(s.totalOutput)} cache=${fmtK(s.totalCacheRead)}  breaks=${s.cacheBreaks} hit=${pct(s.avgCacheHitRate)}  Y=${s.wasteY} P=${s.wasteP}`,
  );
  out.push("-".repeat(72));
  out.push(
    pad(" #", 4) +
      pad("rd", 4) +
      pad("F", 3) +
      pad("in", 8) +
      pad("out", 8) +
      pad("cache", 8) +
      pad("hit", 5) +
      " purpose",
  );
  for (const st of report.steps) {
    const f = st.cacheBreak ? "!" + st.waste : st.waste;
    out.push(
      pad(String(st.index), 4) +
        pad(String(st.round ?? "-"), 4) +
        pad(f, 3) +
        pad(st.inputTokens ? fmtK(st.inputTokens) : "-", 8) +
        pad(st.outputTokens ? fmtK(st.outputTokens) : "-", 8) +
        pad(st.cacheRead ? fmtK(st.cacheRead) : "-", 8) +
        pad(pct(st.cacheHitRate), 5) +
        " " +
        st.purpose +
        (st.wasteReason ? `  [${st.wasteReason}]` : ""),
    );
  }
  return out.join("\n");
}

function pad(s: string, n: number): string {
  const t = s.slice(0, n);
  return t + " ".repeat(Math.max(0, n - t.length));
}

/** 写入 .maou/sessions/<id>.analyze.md */
export function writeAnalyzeReport(report: SessionAnalyzeReport, cwd = process.cwd()): string {
  const dir = projectSessionsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${report.sessionId}.analyze.md`);
  writeFileSync(path, formatAnalyzeMarkdown(report), "utf-8");
  return path;
}

/** 一行摘要（toast / slash） */
export function formatAnalyzeSummaryLine(report: SessionAnalyzeReport): string {
  const s = report.summary;
  return `诊断 ${report.sessionId}: ${s.totalSteps}步 · in ${fmtK(s.totalInput)} · cache ${fmtK(s.totalCacheRead)} · 断点${s.cacheBreaks} · Y${s.wasteY}/P${s.wasteP} · 命中${pct(s.avgCacheHitRate)}`;
}

export function analyzeReportDir(report: SessionAnalyzeReport): string {
  return report.sessionFile ? dirname(report.sessionFile) : "";
}
