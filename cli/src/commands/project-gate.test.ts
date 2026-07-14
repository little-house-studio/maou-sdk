import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isProjectInitialized,
  initializeProject,
  ensureProjectConsent,
  PROJECT_MARKER,
} from "./project-gate.js";

describe("project-gate", () => {
  let dir: string;
  let prevYes: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "maou-proj-"));
    prevYes = process.env.MAOU_PROJECT_YES;
    delete process.env.MAOU_PROJECT_YES;
  });

  afterEach(() => {
    if (prevYes === undefined) delete process.env.MAOU_PROJECT_YES;
    else process.env.MAOU_PROJECT_YES = prevYes;
    rmSync(dir, { recursive: true, force: true });
  });

  it("未初始化时 isProjectInitialized=false", () => {
    expect(isProjectInitialized(dir)).toBe(false);
  });

  it("initializeProject 写入 project.json", () => {
    const meta = initializeProject(dir, "coding-agent");
    expect(isProjectInitialized(dir)).toBe(true);
    expect(meta.cwd).toBe(dir);
    const raw = JSON.parse(
      readFileSync(join(dir, ".maou", PROJECT_MARKER), "utf-8"),
    );
    expect(raw.product).toBe("coding-agent");
    expect(existsSync(join(dir, ".maou", "sessions"))).toBe(true);
  });

  it("ensureProjectConsent --yes 非交互通过", async () => {
    const ok = await ensureProjectConsent({ cwd: dir, yes: true });
    expect(ok).toBe(true);
    expect(isProjectInitialized(dir)).toBe(true);
  });

  it("已初始化则直接通过", async () => {
    initializeProject(dir);
    const ok = await ensureProjectConsent({ cwd: dir });
    expect(ok).toBe(true);
  });
});
