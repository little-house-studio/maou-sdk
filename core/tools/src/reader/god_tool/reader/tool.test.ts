import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReadTool } from "./tool.js";
import type { ToolContext } from "../../../base.js";

describe("reader pagination footer", () => {
  const dirs: string[] = [];
  const tool = new ReadTool();

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function fixture(content: string, name = "sample.txt"): { root: string; path: string } {
    const root = join(tmpdir(), `maou-reader-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(root, { recursive: true });
    dirs.push(root);
    writeFileSync(join(root, name), content, "utf-8");
    return { root, path: name };
  }

  function ctx(root: string): ToolContext {
    return {
      projectRoot: root,
      workingDirectory: root,
      sessionId: "sess-reader",
      agentMode: null,
    } as unknown as ToolContext;
  }

  async function read(
    root: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const res = await tool.execute(
      { description: "test", reason: "test", ...params },
      ctx(root),
    );
    expect(res.ok).toBe(true);
    return res.message;
  }

  it("says end of file when the whole file fits", async () => {
    const { root, path } = fixture("a\nb\nc");
    const out = await read(root, { path });
    expect(out).toContain("End of file - total 3 lines.");
    expect(out).not.toContain("Use start_line=");
  });

  it("hands back the next start_line when a range stops short", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`).join("\n");
    const { root, path } = fixture(lines);
    const out = await read(root, { path, start_line: 5, end_line: 12 });
    expect(out).toContain("Showing lines 5-12 of 50.");
    expect(out).toContain("Use start_line=13 to continue.");
  });

  it("reports the char cut and still points at the next line", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `padded-line-${i + 1}`).join("\n");
    const { root, path } = fixture(lines);
    const out = await read(root, { path, max_chars: 500 });
    expect(out).toContain("Cut at max_chars=500");
    expect(out).toMatch(/Use start_line=\d+ to continue\./);
    expect(out).toContain("truncated=true");
  });

  it("cuts a minified single line instead of pasting it whole", async () => {
    const huge = `{"k":"${"v".repeat(9000)}"}`;
    const { root, path } = fixture(huge, "bundle.min.js");
    const out = await read(root, { path });
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toContain("line cut at 2000 chars");
    expect(out).toContain("long line(s) cut");
  });

  it("does not claim a cut when nothing was cut", async () => {
    const { root, path } = fixture("only\ntwo\n");
    const out = await read(root, { path, max_chars: 100_000 });
    expect(out).not.toContain("Cut at max_chars");
    expect(out).not.toContain("line cut at");
  });
});
