/**
 * 工具输出压缩器 —— 在工具结果进入 LLM 上下文之前做"摄入层"压缩（对标 RTK）。
 *
 * 设计原则：保守、保信号。
 * - 短输出原样返回（不动）。
 * - 去重/去噪是无损语义（重复行折叠成计数、去 ANSI）。
 * - 超长才截断，且保留头尾（错误通常在头或尾）。
 * - 测试输出只留失败项 + 摘要；找不到失败信号则回退通用压缩（不冒险丢信息）。
 *
 * 注：有损压缩。配合 TaskSessionStore 原文落盘 + restoreTask，可在需要时恢复。
 */

const ANSI_RE = /\[[0-9;]*[a-zA-Z]/g;
// 进度条/回车覆盖行常见噪声（npm/pip/cargo 下载进度等）
const CARRIAGE_RE = /^.*\r(?=.)/gm;

export interface CompressOptions {
  /** 超过此行数才触发截断（默认 40）。 */
  maxLines?: number;
  /** 截断时保留的头部行数（默认 30）。 */
  headLines?: number;
  /** 截断时保留的尾部行数（默认 10）。 */
  tailLines?: number;
  /** 折叠连续重复行（默认 true）。 */
  dedupe?: boolean;
  /** 去除 ANSI 转义码（默认 true）。 */
  stripAnsiCodes?: boolean;
  /** 压缩级别；覆盖 maxLines/headLines/tailLines 的级别预设。默认 normal。 */
  level?: CompressLevel;
}

/** 压缩级别：off=不压缩；normal=保守；aggressive=更激进（更低阈值）。 */
export type CompressLevel = "off" | "normal" | "aggressive";

/** 各级别的截断阈值；off 返回 null 表示不压缩。 */
function levelThresholds(level: CompressLevel): { maxLines: number; headLines: number; tailLines: number } | null {
  switch (level) {
    case "off": return null;
    case "aggressive": return { maxLines: 20, headLines: 12, tailLines: 6 };
    case "normal":
    default: return { maxLines: 40, headLines: 30, tailLines: 10 };
  }
}

/** 去 ANSI 转义码 + 回车覆盖噪声。 */
export function stripNoise(s: string): string {
  return s.replace(CARRIAGE_RE, "").replace(ANSI_RE, "");
}

/** 折叠连续重复行 → `行  [×N]`。 */
export function dedupeConsecutive(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let prev: string | null = null;
  let count = 0;
  const flush = () => {
    if (prev === null) return;
    out.push(count > 1 ? `${prev}  [×${count}]` : prev);
  };
  for (const line of lines) {
    if (line === prev) count++;
    else { flush(); prev = line; count = 1; }
  }
  flush();
  return out.join("\n");
}

/** 截断长文本：保留头 headLines + 尾 tailLines，中间省略。 */
export function truncateMiddle(text: string, headLines: number, tailLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= headLines + tailLines + 1) return text;
  const omitted = lines.length - headLines - tailLines;
  return [
    ...lines.slice(0, headLines),
    `… [省略 ${omitted} 行，如需完整内容请缩小范围重查] …`,
    ...lines.slice(lines.length - tailLines),
  ].join("\n");
}

/** 通用输出压缩：去噪 → 去重 → 超长截断头尾。短输出原样返回。 */
export function compressOutput(text: string, opts: CompressOptions = {}): string {
  if (!text) return text;
  const th = levelThresholds(opts.level ?? "normal");
  if (!th) return text; // off：原样返回
  const {
    maxLines = th.maxLines,
    headLines = th.headLines,
    tailLines = th.tailLines,
    dedupe = true,
    stripAnsiCodes = true,
  } = opts;
  let s = stripAnsiCodes ? stripNoise(text) : text;
  if (dedupe) s = dedupeConsecutive(s);
  if (s.split("\n").length > maxLines) s = truncateMiddle(s, headLines, tailLines);
  return s;
}

// ─── 终端语义压缩 ─────────────────────────────────────────────────────────────

const TEST_CMD_RE = /\b(cargo\s+(test|nextest)|pytest|jest|vitest|go\s+test|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+test|mocha|phpunit|rspec)\b/;
const FAIL_RE = /(fail|failed|failure|error|panic|assert|✗|✘|×|✖|❌|exception|traceback|not ok|✕|expected|received)/i;
const SUMMARY_RE = /(test result:|tests?\s+(passed|failed|run)|passed|failed|skipped|\d+\s+(passing|failing|pending)|ran\s+\d+|summary|total)/i;

/**
 * 测试输出压缩：只保留失败相关行 + 摘要行，丢弃通过详情。
 * 若没检测到失败信号（可能全过或非标准格式），回退通用压缩，避免误删。
 */
export function compressTestOutput(text: string, level: CompressLevel = "normal"): string {
  if (level === "off") return text;
  const th = levelThresholds(level)!;
  const lines = stripNoise(text).split("\n");
  if (lines.length <= th.maxLines) return dedupeConsecutive(lines.join("\n"));

  const hasFailure = lines.some((l) => FAIL_RE.test(l));
  if (!hasFailure) {
    // 全过 / 无明显失败：保留摘要 + 头尾即可
    return compressOutput(text, { level });
  }

  const kept: string[] = [];
  let lastKeptIdx = -2;
  lines.forEach((line, i) => {
    const isSignal = FAIL_RE.test(line) || SUMMARY_RE.test(line);
    // 失败行 + 其后续上下文（紧跟的非空缩进行，常是堆栈/原因）
    if (isSignal || (lastKeptIdx === i - 1 && /^\s+\S/.test(line) && line.trim().length > 0)) {
      kept.push(line);
      lastKeptIdx = i;
    }
  });
  const body = dedupeConsecutive(kept.join("\n"));
  const removed = lines.length - kept.length;
  return removed > 0
    ? `${body}\n[已折叠 ${removed} 行通过/噪声输出，仅保留失败与摘要]`
    : body;
}

/** 终端输出语义压缩：按命令类型选策略。 */
export function compressTerminalOutput(command: string, output: string, level: CompressLevel = "normal"): string {
  if (!output || level === "off") return output;
  const cmd = command.trim().toLowerCase();
  if (TEST_CMD_RE.test(cmd)) return compressTestOutput(output, level);
  // git 与其它命令走通用（去噪+去重+超长截断），diff/log 过长时保留头尾
  return compressOutput(output, { level });
}

// ─── 代码签名抽取（reader 签名模式，对标 RTK -l aggressive）──────────────────

function signaturePatterns(ext: string): RegExp[] {
  switch (ext) {
    case ".ts": case ".tsx": case ".mts": case ".cts":
    case ".js": case ".jsx": case ".mjs": case ".cjs":
      return [
        /^(export\s+)?(default\s+)?(abstract\s+)?(class|interface|enum|namespace)\b/,
        /^(export\s+)?type\s+\w+/,
        /^(export\s+)?(declare\s+)?(async\s+)?function\b/,
        /^(export\s+)?const\s+\w+\s*[:=]\s*(async\s*)?(\([^)]*\)|function|<)/,
        /^\s*(public|private|protected|static|readonly|async|get|set)?\s*[\w$]+\s*\??\s*\([^)]*\)\s*[:{]/,
      ];
    case ".py":
      return [/^\s*(async\s+)?def\s+\w+/, /^\s*class\s+\w+/, /^\s*@\w+/];
    case ".rs":
      return [
        /^\s*(pub\s+)?(async\s+)?(unsafe\s+)?fn\s+\w+/,
        /^\s*(pub\s+)?(struct|enum|trait|impl|mod|type)\b/,
      ];
    case ".go":
      return [/^func\s+/, /^type\s+\w+\s+(struct|interface|func)\b/];
    case ".java": case ".kt":
      return [/^\s*(public|private|protected)?\s*(static|final|abstract)?\s*(class|interface|enum)\b/, /^\s*(public|private|protected|static|final)[\w\s<>,]*\s+\w+\s*\(/];
    default:
      return [];
  }
}

/**
 * 抽取代码文件的函数/类/接口签名（正则启发式）。
 * 返回 `行号→签名` 列表；非代码或抽不到时返回 null（调用方回退原文）。
 */
export function extractSignatures(content: string, ext: string): string | null {
  const patterns = signaturePatterns(ext);
  if (patterns.length === 0) return null;
  const lines = content.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (patterns.some((re) => re.test(line))) {
      // 去掉尾部 { 让签名更紧凑
      const sig = line.replace(/\s*\{\s*$/, "").replace(/\s+$/, "");
      out.push(`${i + 1}→${sig}`);
    }
  });
  if (out.length === 0) return null;
  return out.join("\n");
}

// ─── grep 按文件归组 ─────────────────────────────────────────────────────────

/**
 * 把 ripgrep 的 `file:line:text` 内容行按文件归组，去掉重复路径前缀：
 *   path/a.ts:
 *     12: foo
 *     34: bar
 * 无损重组，纯省 token。
 */
export function groupGrepByFile(lines: string[]): string[] {
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  const passthrough: string[] = [];
  for (const raw of lines) {
    // 匹配 file:line:rest（路径里可能含冒号，故从右侧解析 line 数字）
    const m = /^(.+?):(\d+):(.*)$/.exec(raw);
    if (!m) { passthrough.push(raw); continue; }
    const [, file, ln, rest] = m;
    if (!groups.has(file)) { groups.set(file, []); order.push(file); }
    groups.get(file)!.push(`  ${ln}: ${rest}`);
  }
  if (order.length === 0) return lines; // 非内容格式，原样返回
  const out: string[] = [];
  for (const file of order) {
    out.push(`${file}:`);
    out.push(...groups.get(file)!);
  }
  if (passthrough.length) out.push(...passthrough);
  return out;
}
