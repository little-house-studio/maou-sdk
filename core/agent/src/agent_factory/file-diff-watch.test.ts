import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FileDiffWatch,
  extractFilePathsFromToolParams,
  isIgnoredPath,
} from "./file-diff-watch.js";

describe("file-diff-watch", () => {
  let root: string;
  let watch: FileDiffWatch;
  const sid = "sess-1";

  beforeEach(() => {
    root = join(tmpdir(), `maou-fdw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), "node_modules/\n*.log\n", "utf-8");
    writeFileSync(join(root, "src", "a.ts"), "line1\nline2\n", "utf-8");
    watch = new FileDiffWatch({
      projectRoot: root,
      maxIdleRounds: 3,
      maxChangeNoticesWithoutTouch: 2,
    });
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("extract paths from tool params", () => {
    expect(extractFilePathsFromToolParams("reader", { path: "src/a.ts" })).toEqual([
      "src/a.ts",
    ]);
    expect(
      extractFilePathsFromToolParams("write_file", { file_path: "x.ts" }),
    ).toEqual(["x.ts"]);
  });

  it("ignores gitignore patterns", () => {
    expect(isIgnoredPath("node_modules/x", ["node_modules/"])).toBe(true);
    expect(isIgnoredPath("src/a.ts", ["node_modules/"])).toBe(false);
  });

  it("enters list on reader touch; no notice if unchanged", () => {
    watch.noteToolTouch(sid, "reader", { path: "src/a.ts" });
    expect(watch.listWatched(sid)).toEqual(["src/a.ts"]);
    const xml = watch.consumeUserTurnDiffs(sid);
    expect(xml).toBe("");
  });

  it("reports change after external edit (case 1)", () => {
    watch.noteToolTouch(sid, "reader", { path: "src/a.ts" });
    // 用户改文件
    writeFileSync(join(root, "src", "a.ts"), "line1\nline2\nline3\nline4\n", "utf-8");
    const xml = watch.consumeUserTurnDiffs(sid);
    expect(xml).toContain("<file_change_notice");
    expect(xml).toContain("optional");
    expect(xml).toContain("src/a.ts");
    expect(xml).toMatch(/ignore/i);
    // 同一改动不再重复
    expect(watch.consumeUserTurnDiffs(sid)).toBe("");
  });

  it("no notice if agent re-touched after user edit (case 2)", () => {
    watch.noteToolTouch(sid, "reader", { path: "src/a.ts" });
    writeFileSync(join(root, "src", "a.ts"), "changed\n", "utf-8");
    // AI 再读/改 → baseline 刷新
    watch.noteToolTouch(sid, "edit_file", { path: "src/a.ts" });
    expect(watch.consumeUserTurnDiffs(sid)).toBe("");
  });

  it("removes after maxChangeNotices without touch", () => {
    watch.noteToolTouch(sid, "reader", { path: "src/a.ts" });
    writeFileSync(join(root, "src", "a.ts"), "v1\n", "utf-8");
    expect(watch.consumeUserTurnDiffs(sid)).toContain("src/a.ts");
    writeFileSync(join(root, "src", "a.ts"), "v2\n", "utf-8");
    // 第 2 次 notice 后移除（max=2）
    const xml2 = watch.consumeUserTurnDiffs(sid);
    expect(xml2).toContain("src/a.ts");
    expect(watch.listWatched(sid)).not.toContain("src/a.ts");
  });

  it("removes after maxIdleRounds without touch", () => {
    watch.noteToolTouch(sid, "reader", { path: "src/a.ts" });
    watch.onAgentRoundEnd(sid); // touched this round → reset
    watch.onAgentRoundEnd(sid);
    watch.onAgentRoundEnd(sid);
    watch.onAgentRoundEnd(sid); // 3 idle
    expect(watch.listWatched(sid)).toEqual([]);
  });

  it("skips gitignored paths", () => {
    writeFileSync(join(root, "app.log"), "x\n", "utf-8");
    watch.noteToolTouch(sid, "reader", { path: "app.log" });
    expect(watch.listWatched(sid)).toEqual([]);
  });
});
