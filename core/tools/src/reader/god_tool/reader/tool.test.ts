import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { READ_LIMIT_LINES, READ_MAX_BYTES, ReadTool, resolveReadWindow } from "./tool.js";
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
    expect(out).toContain("total_chars=5");
    expect(out).not.toContain("Use offset=");
  });

  it("hands back the next offset when a range stops short", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i + 1}`).join("\n");
    const { root, path } = fixture(lines);
    const out = await read(root, { path, start_line: 5, end_line: 12 });
    expect(out).toContain("Showing lines 5-12 of 50.");
    expect(out).toContain("Use offset=13 to continue.");
  });

  it("reports the char cut and still points at the next line", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `padded-line-${i + 1}`).join("\n");
    const { root, path } = fixture(lines);
    const out = await read(root, { path, max_chars: 500 });
    expect(out).toContain("Cut at max_chars=500");
    expect(out).toMatch(/Use offset=\d+ to continue\./);
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
    const out = await read(root, { path });
    expect(out).not.toContain("Cut at max_chars");
    expect(out).not.toContain("line cut at");
    expect(out).not.toContain("50KiB");
  });

  it("caps one call at 2000 lines", async () => {
    const lines = Array.from({ length: READ_LIMIT_LINES + 80 }, (_, i) => `L${i + 1}`).join("\n");
    const { root, path } = fixture(lines);
    const out = await read(root, { path });
    expect(out).toContain(`Showing lines 1-${READ_LIMIT_LINES} of ${READ_LIMIT_LINES + 80}.`);
    expect(out).toContain(`Use offset=${READ_LIMIT_LINES + 1} to continue.`);
    expect(out).not.toContain(`→L${READ_LIMIT_LINES + 1}`);
  });

  it("caps one call at 50KiB", async () => {
    const line = "x".repeat(800);
    const lines = Array.from({ length: 200 }, () => line).join("\n");
    const { root, path } = fixture(lines);
    const out = await read(root, { path });
    expect(Buffer.byteLength(out, "utf8")).toBeLessThan(READ_MAX_BYTES + 800);
    expect(out).toContain("Cut at 51200 bytes (50KiB per read).");
    expect(out).toMatch(/Use offset=\d+ to continue\./);
  });

  it("pages by offset and limit", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `row-${i + 1}`).join("\n");
    const { root, path } = fixture(lines);
    const out = await read(root, { path, offset: 10, limit: 5 });
    expect(out).toContain("→row-10");
    expect(out).toContain("→row-14");
    expect(out).not.toContain("→row-15");
    expect(out).toContain("Showing lines 10-14 of 40.");
    expect(out).toContain("Use offset=15 to continue.");
  });
});

describe("resolveReadWindow", () => {
  it("defaults to the first 2000 lines", () => {
    expect(resolveReadWindow({}, 5000)).toEqual({ start: 1, end: 2000, limit: 2000 });
  });

  it("uses offset and limit as a line window", () => {
    expect(resolveReadWindow({ offset: 10, limit: 5 }, 40)).toEqual({
      start: 10,
      end: 14,
      limit: 5,
    });
  });

  it("still accepts start_line and end_line", () => {
    expect(resolveReadWindow({ start_line: 5, end_line: 12 }, 50)).toEqual({
      start: 5,
      end: 12,
      limit: 8,
    });
  });

  it("lets offset/limit win when both styles are present", () => {
    expect(resolveReadWindow({ offset: 20, start_line: 1, limit: 3, end_line: 99 }, 80)).toEqual({
      start: 20,
      end: 22,
      limit: 3,
    });
  });

  it("caps limit at 2000", () => {
    expect(resolveReadWindow({ offset: 1, limit: 9000 }, 10000).limit).toBe(2000);
  });
});
