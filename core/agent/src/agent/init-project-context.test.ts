/**
 * parseCommandMarkdown / compileProjectContext smoke tests
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCommandMarkdown } from "./command-runner.js";
import { compileProjectContext, loadProjectContext } from "@little-house-studio/context";

describe("parseCommandMarkdown", () => {
  it("defaults to reply without frontmatter", () => {
    const r = parseCommandMarkdown("# hi\n\nbody");
    expect(r.kind).toBe("reply");
    expect(r.body).toContain("body");
  });

  it("parses mode: task frontmatter", () => {
    const raw = `---
mode: task
description: init project
---

# Task

Do the thing.
`;
    const r = parseCommandMarkdown(raw);
    expect(r.kind).toBe("task");
    expect(r.meta.mode).toBe("task");
    expect(r.body).toContain("Do the thing");
    expect(r.body).not.toContain("mode: task");
  });
});

describe("compileProjectContext", () => {
  it("loads .maou/project five files into xml project_info", () => {
    const root = join(tmpdir(), `maou-proj-ctx-${Date.now()}`);
    const dir = join(root, ".maou", "project");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "USER.md"), "call me boss");
    writeFileSync(join(dir, "PROJECT.md"), "a demo app");
    writeFileSync(join(dir, "RULE.md"), "no force push");
    writeFileSync(join(dir, "DESIGN.md"), "simple first");
    writeFileSync(join(dir, "EXPERIENCE.md"), "watch ports");

    const loaded = loadProjectContext(root);
    expect(loaded.userContext).toBe("call me boss");
    expect(loaded.experienceContext).toBe("watch ports");

    const text = compileProjectContext(root);
    expect(text).toContain("<project_info>");
    expect(text).toContain("<user>");
    expect(text).toContain("<project>");
    expect(text).toContain("<rules>");
    expect(text).toContain("<design>");
    expect(text).toContain("<experience>");
    expect(text).toContain("no force push");

    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to legacy .maou/context", () => {
    const root = join(tmpdir(), `maou-proj-ctx-legacy-${Date.now()}`);
    const dir = join(root, ".maou", "context");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "USER.md"), "legacy user");
    writeFileSync(join(dir, "PROJECT.md"), "legacy project");
    writeFileSync(join(dir, "RULE.md"), "legacy rule");

    const text = compileProjectContext(root);
    expect(text).toContain("legacy user");
    expect(text).toContain("<rules>");

    rmSync(root, { recursive: true, force: true });
  });

  it("minimal mode only injects RULE.md", () => {
    const root = join(tmpdir(), `maou-proj-ctx-min-${Date.now()}`);
    const dir = join(root, ".maou", "project");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "USER.md"), "user secret prefs");
    writeFileSync(join(dir, "RULE.md"), "only rules");
    const text = compileProjectContext(root, { mode: "minimal" });
    expect(text).toContain("only rules");
    expect(text).not.toContain("user secret prefs");
    expect(compileProjectContext(root, { mode: "off" })).toBe("");
    rmSync(root, { recursive: true, force: true });
  });
});
