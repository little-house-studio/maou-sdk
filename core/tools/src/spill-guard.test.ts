import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOOL_OUTPUT_SPILL_LIMIT, applySpillGuard, isSpillExempt } from "./spill-guard.js";
import type { ToolCall, ToolContext, ToolResponse } from "./base.js";

function response(message: string): ToolResponse {
  return {
    ok: true,
    message,
    displayEvents: [],
    payload: {},
    background: false,
    images: [],
  };
}

function call(name: string): ToolCall {
  return { id: "call-1", name, parameters: {} };
}

describe("applySpillGuard", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function ctx(projectRoot: string): ToolContext {
    return { projectRoot, sessionId: "sess-1" } as unknown as ToolContext;
  }

  function root(): string {
    const dir = join(tmpdir(), `maou-spillguard-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    return dir;
  }

  it("leaves small outputs untouched", () => {
    const res = response("short");
    expect(applySpillGuard(res, call("grep"), ctx(root()))).toBe(res);
  });

  it("spills a huge output to disk and keeps the full text recoverable", () => {
    const dir = root();
    const body = `${"HEAD".repeat(50)}${"M".repeat(TOOL_OUTPUT_SPILL_LIMIT * 2)}${"TAIL".repeat(50)}`;
    const out = applySpillGuard(response(body), call("grep"), ctx(dir));
    expect(out.message.length).toBeLessThan(body.length);
    expect(out.message).toContain("HEAD");
    expect(out.message).toContain("TAIL");

    const spillPath = String(out.payload?.spillPath ?? "");
    expect(spillPath).toBeTruthy();
    expect(existsSync(spillPath)).toBe(true);
    expect(readFileSync(spillPath, "utf-8")).toBe(body);
    // 出路必须在正文里，否则模型看不到全文在哪
    expect(out.message).toContain(spillPath);
    expect(out.message).toMatch(/read tool/);
  });

  it("exempts the read family so reading a spill file cannot spill again", () => {
    const dir = root();
    const body = "R".repeat(TOOL_OUTPUT_SPILL_LIMIT * 2);
    for (const name of ["read", "read_file", "reader", "read_image", "web_fetch"]) {
      expect(isSpillExempt(name)).toBe(true);
      const res = response(body);
      expect(applySpillGuard(res, call(name), ctx(dir))).toBe(res);
    }
    expect(isSpillExempt("grep")).toBe(false);
    expect(isSpillExempt("use_terminal")).toBe(true);
  });

  it("falls back to plain truncation without flipping ok when the disk is unavailable", () => {
    const body = "Z".repeat(TOOL_OUTPUT_SPILL_LIMIT * 2);
    const out = applySpillGuard(response(body), call("grep"), ctx(""));
    expect(out.ok).toBe(true);
    expect(out.message.length).toBeLessThan(body.length);
    expect(out.payload?.spillPath).toBeUndefined();
  });

  it("keeps a failure a failure", () => {
    const body = "E".repeat(TOOL_OUTPUT_SPILL_LIMIT * 2);
    const failed = { ...response(body), ok: false };
    const out = applySpillGuard(failed, call("grep"), ctx(root()));
    expect(out.ok).toBe(false);
    expect(out.message.length).toBeLessThan(body.length);
  });
});
