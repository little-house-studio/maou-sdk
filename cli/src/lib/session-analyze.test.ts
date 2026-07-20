import { describe, it, expect } from "vitest";
import {
  analyzeSessionJsonl,
  formatAnalyzeMarkdown,
  formatAnalyzeSummaryLine,
} from "./session-analyze.js";

const FIXTURE = `
{"type":"message","role":"user","content":"hello","createdAt":"2026-01-01T00:00:00.000Z"}
{"type":"message","role":"assistant","content":"","round":1,"toolCalls":[{"id":"t1","name":"reader","parameters":{"path":"a.md"}}],"usage":{"prompt_tokens":1000,"completion_tokens":50,"cached_tokens":800}}
{"type":"message","role":"tool","tool_name":"reader","tool_call_id":"t1","content":"file contents","tool_ok":true,"round":1}
{"type":"message","role":"assistant","content":"ok","round":2,"toolCalls":[{"id":"t2","name":"reader","parameters":{"path":"a.md"}}],"usage":{"prompt_tokens":2000,"completion_tokens":40,"cached_tokens":0}}
{"type":"message","role":"tool","tool_name":"reader","tool_call_id":"t2","content":"file contents","tool_ok":true,"round":2}
{"type":"message","role":"assistant","content":"","round":3,"toolCalls":[{"id":"t3","name":"reader","parameters":{"path":"a.md"}}],"usage":{"prompt_tokens":3000,"completion_tokens":30,"cached_tokens":100}}
{"type":"message","role":"tool","tool_name":"reader","tool_call_id":"t3","content":"file contents","tool_ok":true,"round":3}
{"type":"message","role":"assistant","content":"","round":4,"toolCalls":[{"id":"t4","name":"reader","parameters":{"path":"a.md"}}],"usage":{"prompt_tokens":4000,"completion_tokens":20,"cached_tokens":200}}
{"type":"message","role":"tool","tool_name":"reader","tool_call_id":"t4","content":"file contents","tool_ok":true,"round":4}
`.trim();

describe("session-analyze", () => {
  it("parses usage + cache break + repeated tools", () => {
    const report = analyzeSessionJsonl("test-sess", FIXTURE);
    expect(report.summary.assistantTurns).toBeGreaterThanOrEqual(3);
    expect(report.summary.cacheBreaks).toBeGreaterThanOrEqual(1);
    // 3+ 次相同 reader path=a.md → 至少一处 Y
    expect(report.summary.wasteY).toBeGreaterThanOrEqual(1);
    expect(report.summary.totalInput).toBe(1000 + 2000 + 3000 + 4000);
    expect(report.steps.some((s) => s.cacheBreak)).toBe(true);
  });

  it("formats markdown with table header", () => {
    const report = analyzeSessionJsonl("test-sess", FIXTURE, "/tmp/x.jsonl");
    const md = formatAnalyzeMarkdown(report);
    expect(md).toContain("# Session 诊断");
    expect(md).toContain("| # |");
    expect(md).toContain("Cache 断点");
  });

  it("summary line is compact", () => {
    const report = analyzeSessionJsonl("test-sess", FIXTURE);
    const line = formatAnalyzeSummaryLine(report);
    expect(line).toContain("test-sess");
    expect(line).toContain("断点");
  });

  it("reads prompt_tokens_details.cached_tokens", () => {
    const raw = `{"type":"message","role":"assistant","content":"hi","usage":{"prompt_tokens":100,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":50}}}`;
    const report = analyzeSessionJsonl("s", raw);
    const a = report.steps.find((s) => s.kind === "assistant");
    expect(a?.cacheRead).toBe(50);
  });
});
