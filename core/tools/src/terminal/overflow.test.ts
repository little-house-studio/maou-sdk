import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyOutputLimit,
  cleanupSpillDir,
  inferPromptWaitState,
  peekOverflow,
  retainTerminalOutput,
  resolveTerminalLineLimit,
  TERMINAL_RESULT_LIMIT_LINES,
  TERMINAL_CAPTURE_MAX_BYTES,
} from "./overflow.js";

describe("terminal overflow + wait", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("infer waiting from prompt, busy from running without prompt", () => {
    expect(inferPromptWaitState("ready\nuser@host$ ", "running")).toBe("waiting");
    expect(inferPromptWaitState("PS C:\\Users\\me> ", "running")).toBe("waiting");
    expect(inferPromptWaitState("building…", "running")).toBe("busy");
    expect(inferPromptWaitState("compiling...\n", "running")).toBe("busy");
    expect(inferPromptWaitState("done\n", "exited")).toBe("exited");
  });

  it("spills overflow next to session and keeps head/tail", () => {
    const root = join(tmpdir(), `maou-spill-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    dirs.push(root);
    const body = `${"HEAD".repeat(80)}\n${"MID".repeat(400)}\n${"TAIL".repeat(80)}`;
    const r = applyOutputLimit(body, 200, {
      projectRoot: root,
      sessionId: "s1",
      terminalId: "vite",
    });
    expect(r.overflowPath).toBeTruthy();
    expect(readFileSync(r.overflowPath!, "utf-8")).toBe(body);
    expect(r.text).toContain("HEAD");
    expect(r.text).toContain("TAIL");
    expect(r.text).toContain(r.overflowPath);
    expect(r.text.length).toBeLessThan(body.length);
    expect(peekOverflow("vite")).toBe(r.overflowPath);
  });

  it("write failure still returns truncated text", () => {
    const r = applyOutputLimit("x".repeat(500), 80, {
      projectRoot: "",
      sessionId: "s",
      terminalId: "t",
    });
    expect(r.overflowPath).toBeUndefined();
    expect(r.text.length).toBeLessThan(500);
    expect(r.text).toMatch(/Omitted/);
  });

  it("defaults result_limit to 200 lines", () => {
    expect(TERMINAL_RESULT_LIMIT_LINES).toBe(200);
    expect(resolveTerminalLineLimit(undefined)).toBe(TERMINAL_RESULT_LIMIT_LINES);
    expect(resolveTerminalLineLimit(20)).toBe(20);
    expect(resolveTerminalLineLimit(0)).toBe(0);
  });

  it("always spills terminal output and keeps the last N lines", () => {
    const root = join(tmpdir(), `maou-term-lines-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    dirs.push(root);
    const lines = Array.from({ length: 40 }, (_, i) => `row-${i + 1}`).join("\n");
    const r = retainTerminalOutput(lines, 5, {
      projectRoot: root,
      sessionId: "s1",
      terminalId: "job",
    });
    expect(r.overflowPath).toBeTruthy();
    expect(readFileSync(r.overflowPath!, "utf-8")).toBe(lines);
    expect(r.text).toContain("row-36");
    expect(r.text).toContain("row-40");
    expect(r.text).not.toContain("row-35");
    expect(r.text).toContain(r.overflowPath);
    expect(r.text).toContain("Showing lines 36-40 of 40.");
    expect(r.text).toMatch(/offset \/ limit|offset/);
  });

  it("caps captured output at 256KiB and keeps the tail", () => {
    const root = join(tmpdir(), `maou-term-cap-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    dirs.push(root);
    const body = `${"H".repeat(1000)}\n${"M".repeat(TERMINAL_CAPTURE_MAX_BYTES)}\n${"T".repeat(80)}`;
    const r = retainTerminalOutput(body, 20, {
      projectRoot: root,
      sessionId: "s1",
      terminalId: "big",
    });
    expect(r.overflowPath).toBeTruthy();
    const stored = readFileSync(r.overflowPath!, "utf-8");
    expect(Buffer.byteLength(stored, "utf8")).toBeLessThanOrEqual(TERMINAL_CAPTURE_MAX_BYTES);
    expect(stored).toContain("T".repeat(80));
    expect(stored).not.toContain("H".repeat(1000));
    expect(r.text).toContain("256KiB");
    expect(r.text).toContain("kept the tail");
  });

  it("deletes spill files older than the ttl", () => {
    const root = join(tmpdir(), `maou-spill-ttl-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    dirs.push(root);
    const stale = join(root, "old.txt");
    writeFileSync(stale, "gone");
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(stale, past, past);
    expect(cleanupSpillDir(root)).toBe(1);
    expect(existsSync(stale)).toBe(false);
  });
});
