/**
 * `maou session analyze [sessionId]` —— Session 诊断 CLI。
 *
 * 用法:
 *   maou session analyze              # 最近会话
 *   maou session analyze <id>
 *   maou session analyze <id> --write # 写 .maou/sessions/<id>.analyze.md
 *   maou session analyze --json
 *   maou session analyze --md         # 默认文本表；--md 输出 markdown
 */

import {
  analyzeSessionFile,
  formatAnalyzeMarkdown,
  formatAnalyzeText,
  resolveLatestSessionId,
  writeAnalyzeReport,
} from "../lib/session-analyze.js";

export interface SessionAnalyzeCliOpts {
  cwd?: string;
  /** 位置参数：session id */
  sessionId?: string;
  write?: boolean;
  json?: boolean;
  md?: boolean;
  argv?: string[];
}

function parseArgv(argv: string[]): {
  sessionId?: string;
  write: boolean;
  json: boolean;
  md: boolean;
} {
  let sessionId: string | undefined;
  let write = false;
  let json = false;
  let md = false;
  for (const a of argv) {
    if (a === "--write" || a === "-w") write = true;
    else if (a === "--json") json = true;
    else if (a === "--md" || a === "--markdown") md = true;
    else if (a.startsWith("-")) continue;
    else if (!sessionId) sessionId = a;
  }
  return { sessionId, write, json, md };
}

/**
 * 运行诊断。成功返回 true。
 */
export function runSessionAnalyze(opts: SessionAnalyzeCliOpts = {}): boolean {
  const cwd = opts.cwd ?? process.cwd();
  const parsed = opts.argv ? parseArgv(opts.argv) : {
    sessionId: opts.sessionId,
    write: !!opts.write,
    json: !!opts.json,
    md: !!opts.md,
  };

  let id = parsed.sessionId;
  if (!id) {
    id = resolveLatestSessionId(cwd) ?? undefined;
  }
  if (!id) {
    process.stderr.write(
      "❌ 未找到会话。请指定 sessionId，或先在本项目跑过 maou（.maou/sessions/）。\n" +
        "   用法: maou session analyze [sessionId] [--write] [--md] [--json]\n",
    );
    return false;
  }

  try {
    const report = analyzeSessionFile(id, cwd);

    if (parsed.write) {
      const path = writeAnalyzeReport(report, cwd);
      process.stderr.write(`✓ 已写入 ${path}\n`);
    }

    if (parsed.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else if (parsed.md || parsed.write) {
      // --write 时仍打印 md 到 stdout 方便管道
      process.stdout.write(formatAnalyzeMarkdown(report) + "\n");
    } else {
      process.stdout.write(formatAnalyzeText(report) + "\n");
    }
    return true;
  } catch (e) {
    process.stderr.write(`❌ ${(e as Error).message ?? e}\n`);
    return false;
  }
}
