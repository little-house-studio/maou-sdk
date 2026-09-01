import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compileWorkspaceInstructions,
  dedupeInstructionFiles,
  diffWorkspaceInstructions,
  loadWorkspaceInstructionFiles,
  resolveWorkspaceInstructionsEnabled,
} from "./workspace-instructions.js";

describe("workspace-instructions", () => {
  const dirs: string[] = [];
  const prev = process.env.MAOU_WORKSPACE_INSTRUCTIONS;
  const prevProject = process.env.MAOU_PROJECT_CONTEXT;

  afterEach(() => {
    if (prev === undefined) delete process.env.MAOU_WORKSPACE_INSTRUCTIONS;
    else process.env.MAOU_WORKSPACE_INSTRUCTIONS = prev;
    if (prevProject === undefined) delete process.env.MAOU_PROJECT_CONTEXT;
    else process.env.MAOU_PROJECT_CONTEXT = prevProject;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function root(): string {
    const dir = join(tmpdir(), `maou-wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    return dir;
  }

  it("defaults on; env/agent can turn off", () => {
    delete process.env.MAOU_WORKSPACE_INSTRUCTIONS;
    expect(resolveWorkspaceInstructionsEnabled()).toBe(true);
    expect(resolveWorkspaceInstructionsEnabled({ agent: false })).toBe(false);
    process.env.MAOU_WORKSPACE_INSTRUCTIONS = "0";
    expect(resolveWorkspaceInstructionsEnabled({ agent: true })).toBe(false);
  });

  it("MAOU_PROJECT_CONTEXT does not control workspace instructions", () => {
    delete process.env.MAOU_WORKSPACE_INSTRUCTIONS;
    process.env.MAOU_PROJECT_CONTEXT = "off";
    expect(resolveWorkspaceInstructionsEnabled()).toBe(true);
  });

  it("does not read disk when compiling empty root", () => {
    const dir = root();
    expect(compileWorkspaceInstructions(dir)).toBe("");
    expect(loadWorkspaceInstructionFiles(dir).every((f) => !f.exists)).toBe(true);
  });

  it("dedupes identical AGENTS.md and CLAUDE.md", () => {
    const dir = root();
    writeFileSync(join(dir, "AGENTS.md"), "same rules\n", "utf-8");
    writeFileSync(join(dir, "CLAUDE.md"), "same rules\n", "utf-8");
    const files = dedupeInstructionFiles(loadWorkspaceInstructionFiles(dir));
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("AGENTS.md");
    const text = compileWorkspaceInstructions(dir);
    expect(text).toContain("AGENTS.md");
    expect(text.match(/<file name=/g)?.length).toBe(1);
  });

  it("notices update and removal", () => {
    const dir = root();
    writeFileSync(join(dir, "AGENTS.md"), "v1", "utf-8");
    writeFileSync(join(dir, "CLAUDE.md"), "other", "utf-8");
    const prevFiles = loadWorkspaceInstructionFiles(dir);
    writeFileSync(join(dir, "AGENTS.md"), "v2", "utf-8");
    rmSync(join(dir, "CLAUDE.md"));
    const notice = diffWorkspaceInstructions(prevFiles, loadWorkspaceInstructionFiles(dir));
    expect(notice).toContain("Updated instructions from: AGENTS.md");
    expect(notice).toContain("Instructions removed: CLAUDE.md");
    expect(notice).toContain("no longer apply");
  });

  it("replaceBaseline declaration", () => {
    const dir = root();
    writeFileSync(join(dir, "AGENTS.md"), "rules", "utf-8");
    expect(compileWorkspaceInstructions(dir, { replaceBaseline: true })).toContain(
      "This complete workspace instruction baseline replaces all earlier workspace instruction baselines.",
    );
  });

  it("does not load AGENT.md", () => {
    const dir = root();
    writeFileSync(join(dir, "AGENT.md"), "legacy name\n", "utf-8");
    const files = loadWorkspaceInstructionFiles(dir);
    expect(files.some((f) => f.exists)).toBe(false);
    expect(compileWorkspaceInstructions(dir)).toBe("");
  });

  it("emits empty replacement when disabled after compact", () => {
    const dir = root();
    writeFileSync(join(dir, "AGENTS.md"), "rules", "utf-8");
    expect(compileWorkspaceInstructions(dir, { enabled: false })).toBe("");
    expect(compileWorkspaceInstructions(dir, { enabled: false, replaceBaseline: true })).toContain(
      "No workspace instructions are currently active.",
    );
  });
});
