/**
 * 裁判测试体系 —— 设计文档「测试系统」的完整实现。
 *
 * 流程：测试问题集 → 被测 agent 跑题 → 裁判 agent 评分 → 成绩单 + index/ 隔离。
 *
 * - loadFromDir：读 tests/suite.jsonc（聚合清单）或遍历 tests/*.json（每题一文件）。
 * - runSubject：用被测 agent 的 send 跑 prompt。
 * - runJudge：用裁判 agent 的 send 评分（criteria + expected + 被测回复）。
 * - runAll：遍历 + 汇总成绩单；每题原始数据落 index/<runId>/<caseId>.json。
 *
 * subjectSend / judgeSend 由调用方注入（复用 AgentRuntime.run，收集 assistant_delta）。
 * 与 defineEval 的 EvalRunner 互补：EvalRunner 是代码断言式，EvalSuite 是裁判 agent 式。
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** 测试题：prompt 给被测 agent，criteria/expected 给裁判，score 分值。 */
export interface TestCase {
  id: string;
  /** 给被测 agent 的提问。 */
  prompt: string;
  /** 期望答案（裁判参考）。 */
  expected?: string;
  /** 裁判判定标准（自然语言）。 */
  criteria: string;
  /** 分值，默认 1。 */
  score?: number;
  /** 超时 ms（subjectSend 用），默认 60000。 */
  timeoutMs?: number;
}

/** 聚合清单 suite.jsonc：引用题目 id 或内联题目。 */
export interface TestSuiteManifest {
  name?: string;
  /** 题目 id 列表（引用同目录 <id>.json）；与 cases 二选一。 */
  caseIds?: string[];
  /** 内联题目数组。 */
  cases?: TestCase[];
}

/** 被测 agent 回复结果。 */
export interface SubjectResult {
  caseId: string;
  reply: string;
  durationMs: number;
  error?: string;
}

/** 裁判评分结果。 */
export interface JudgeResult {
  caseId: string;
  score: number;
  maxScore: number;
  passed: boolean;
  comment: string;
  durationMs: number;
}

/** 单题汇总。 */
export interface TestCaseReport {
  case: TestCase;
  subject: SubjectResult;
  judge: JudgeResult;
}

/** 成绩单。 */
export interface TestReport {
  suiteName: string;
  cases: TestCaseReport[];
  totalScore: number;
  totalMaxScore: number;
  passedCount: number;
  totalCount: number;
  durationMs: number;
  indexDir: string;
}

/** send 函数：给 agent 发消息，返回最终回复文本。 */
export type AgentSend = (message: string, timeoutMs?: number) => Promise<string>;

// ─── EvalSuite ─────────────────────────────────────────────────────────────

export class EvalSuite {
  /**
   * 从 testsDir 加载题目：
   * - 有 suite.jsonc → 按清单（caseIds 引用 或 cases 内联）
   * - 否则 → 遍历 *.json（排除 suite.jsonc）
   */
  static loadFromDir(testsDir: string): TestCase[] {
    if (!existsSync(testsDir)) return [];
    const manifestPath = join(testsDir, "suite.jsonc");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(stripJsonc(readFileSync(manifestPath, "utf-8"))) as TestSuiteManifest;
      if (Array.isArray(manifest.cases) && manifest.cases.length > 0) {
        return manifest.cases.map((c, i) => ({ score: 1, ...c, id: c.id ?? `case-${i}` }));
      }
      if (Array.isArray(manifest.caseIds)) {
        return manifest.caseIds
          .map((id) => loadCaseFile(join(testsDir, `${id}.json`)))
          .filter((c): c is TestCase => c !== null);
      }
    }
    // 遍历 *.json（排除 suite.jsonc 本身）
    return readdirSync(testsDir)
      .filter((f) => f.endsWith(".json") && f !== "suite.json")
      .sort()
      .map((f) => loadCaseFile(join(testsDir, f)))
      .filter((c): c is TestCase => c !== null);
  }

  /** 跑被测 agent。 */
  static async runSubject(c: TestCase, subjectSend: AgentSend): Promise<SubjectResult> {
    const t0 = Date.now();
    try {
      const reply = await subjectSend(c.prompt, c.timeoutMs ?? 60000);
      return { caseId: c.id, reply, durationMs: Date.now() - t0 };
    } catch (err) {
      return { caseId: c.id, reply: "", durationMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 跑裁判 agent：把 criteria+expected+被测回复喂给它，解析评分。 */
  static async runJudge(c: TestCase, subject: SubjectResult, judgeSend: AgentSend): Promise<JudgeResult> {
    const t0 = Date.now();
    const maxScore = c.score ?? 1;
    const prompt = [
      "请对下面被测 agent 的回复评分。",
      "",
      `【判定标准】${c.criteria}`,
      c.expected ? `【期望答案】${c.expected}` : "",
      `【分值】满分 ${maxScore}`,
      "",
      "【被测回复】",
      subject.reply || "（被测无回复/出错）",
      subject.error ? `\n（被测出错: ${subject.error}）` : "",
      "",
      `请用 grade 工具输出评分（score 0~${maxScore}，comment 评语，passed 是否合格）。`,
    ].filter(Boolean).join("\n");
    try {
      const judgeReply = await judgeSend(prompt, 60000);
      const parsed = parseGrade(judgeReply, maxScore);
      return { caseId: c.id, maxScore, ...parsed, durationMs: Date.now() - t0 };
    } catch (err) {
      return { caseId: c.id, score: 0, maxScore, passed: false, comment: `裁判出错: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - t0 };
    }
  }

  /**
   * 跑整套测试：被测→裁判→汇总→落 index/。
   * @param testsDir 题目目录
   * @param subjectSend 被测 agent send
   * @param judgeSend 裁判 agent send
   * @param opts.indexDir 原始数据目录（默认 <testsDir>/index/<runId>/）
   */
  static async runAll(
    testsDir: string,
    subjectSend: AgentSend,
    judgeSend: AgentSend,
    opts?: { indexDir?: string; suiteName?: string },
  ): Promise<TestReport> {
    const t0 = Date.now();
    const cases = EvalSuite.loadFromDir(testsDir);
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const indexDir = opts?.indexDir ?? join(testsDir, "index", runId);
    mkdirSync(indexDir, { recursive: true });

    const reports: TestCaseReport[] = [];
    let totalScore = 0;
    let totalMaxScore = 0;
    let passedCount = 0;

    for (const c of cases) {
      const subject = await EvalSuite.runSubject(c, subjectSend);
      const judge = await EvalSuite.runJudge(c, subject, judgeSend);
      // 落 index/（每题独立文件，并发安全）
      writeFileSync(
        join(indexDir, `${safeFileName(c.id)}.json`),
        JSON.stringify({ case: c, subject, judge, ts: new Date().toISOString() }, null, 2),
        "utf-8",
      );
      reports.push({ case: c, subject, judge });
      totalScore += judge.score;
      totalMaxScore += judge.maxScore;
      if (judge.passed) passedCount++;
    }

    return {
      suiteName: opts?.suiteName ?? `eval-${runId}`,
      cases: reports,
      totalScore,
      totalMaxScore,
      passedCount,
      totalCount: cases.length,
      durationMs: Date.now() - t0,
      indexDir,
    };
  }

  /** 成绩单文本。 */
  static formatReport(report: TestReport): string {
    const lines: string[] = [];
    lines.push(`# 成绩单：${report.suiteName}`);
    lines.push(`总分：${report.totalScore}/${report.totalMaxScore} | 通过：${report.passedCount}/${report.totalCount} | 耗时：${report.durationMs}ms`);
    lines.push(`index：${report.indexDir}`);
    lines.push("");
    for (const r of report.cases) {
      const icon = r.judge.passed ? "✅" : "❌";
      lines.push(`${icon} ${r.case.id} — ${r.judge.score}/${r.judge.maxScore}`);
      lines.push(`   题目：${r.case.prompt.replace(/\s+/g, " ").slice(0, 60)}`);
      lines.push(`   评语：${r.judge.comment}`);
      if (r.subject.error) lines.push(`   ⚠ 被测出错：${r.subject.error}`);
    }
    return lines.join("\n");
  }
}

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function loadCaseFile(path: string): TestCase | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (data && typeof data === "object" && data.prompt) {
      return { score: 1, ...data, id: data.id ?? path.replace(/.*\//, "").replace(/\.json$/, "") };
    }
    return null;
  } catch {
    return null;
  }
}

/** 从裁判回复解析评分（容忍 JSON 包裹在文本里 / grade 工具调用格式）。 */
function parseGrade(reply: string, maxScore: number): { score: number; passed: boolean; comment: string } {
  // 尝试找 JSON 对象
  const jsonMatch = reply.match(/\{[^{}]*"score"[^{}]*\}/s);
  if (jsonMatch) {
    try {
      const g = JSON.parse(jsonMatch[0]);
      const score = Math.max(0, Math.min(maxScore, Number(g.score) || 0));
      return {
        score,
        passed: typeof g.passed === "boolean" ? g.passed : score >= maxScore * 0.6,
        comment: String(g.comment ?? g.reason ?? ""),
      };
    } catch { /* fallthrough */ }
  }
  // 回退：无结构化输出，按回复文本给 0 分 + 全文当评语
  return { score: 0, passed: false, comment: reply.slice(0, 200) };
}

function safeFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** 简易 JSONC 去注释（行注释 + 块注释 + 尾逗号）。 */
function stripJsonc(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
}
