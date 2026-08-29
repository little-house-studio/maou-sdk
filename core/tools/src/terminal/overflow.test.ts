import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyOutputLimit, inferPromptWaitState, peekOverflow } from "./overflow.js";

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
});
