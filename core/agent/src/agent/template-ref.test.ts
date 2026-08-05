/**
 * .agent.ref 旧路径迁移（agent/ → agent-products/）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getTemplateRef,
  migrateLegacyProductTemplatePath,
} from "./template-ref.js";

describe("template-ref legacy migrate", () => {
  let root: string;
  let oldTpl: string;
  let newTpl: string;
  let agentDir: string;

  beforeEach(() => {
    root = join(
      tmpdir(),
      `maou-ref-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    // 模拟 monorepo 新路径（旧路径故意不存在）
    newTpl = join(
      root,
      "maou-sdk",
      "agent-products",
      "coding-agent",
      "templates",
      "coding",
    );
    oldTpl = join(
      root,
      "maou-sdk",
      "agent",
      "coding-agent",
      "templates",
      "coding",
    );
    mkdirSync(join(newTpl, "prompt", "system"), { recursive: true });
    writeFileSync(join(newTpl, "prompt", "system", "system.md"), "# hi\n");
    agentDir = join(root, "instance");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, ".agent.ref"), oldTpl + "\n");
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("migrateLegacyProductTemplatePath rewrites agent/ to agent-products/", () => {
    const m = migrateLegacyProductTemplatePath(oldTpl);
    expect(m).toBe(newTpl);
  });

  it("getTemplateRef rewrites disk and returns new path", () => {
    const resolved = getTemplateRef(agentDir);
    expect(resolved).toBe(newTpl);
    expect(readFileSync(join(agentDir, ".agent.ref"), "utf-8").trim()).toBe(
      newTpl,
    );
  });
});
