import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_CUSTOM_KEYS,
  patchAgentCustomConfig,
  readAgentWorkspaceInstructions,
  resolveAgentConfig,
} from "./template.js";

describe("agent custom settings", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function agentDir(): string {
    const dir = join(tmpdir(), `maou-agent-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    return dir;
  }

  it("workspace_instructions is a custom key and overlays the template", () => {
    expect(AGENT_CUSTOM_KEYS).toContain("workspace_instructions");
    expect(AGENT_CUSTOM_KEYS).toContain("terminal_mode");
    const dir = agentDir();
    writeFileSync(
      join(dir, "agent.json"),
      JSON.stringify({ name: "coding", workspace_instructions: true, terminal_mode: "auto" }),
      "utf-8",
    );
    const merged = patchAgentCustomConfig(dir, {
      workspace_instructions: false,
      terminal_mode: "yolo",
      not_a_key: "drop",
    });
    expect(merged.workspace_instructions).toBe(false);
    expect(merged.terminal_mode).toBe("yolo");
    expect(merged.not_a_key).toBeUndefined();
    const custom = JSON.parse(readFileSync(join(dir, "agent.custom.json"), "utf-8")) as Record<string, unknown>;
    expect(custom.workspace_instructions).toBe(false);
    expect(custom.not_a_key).toBeUndefined();
    expect(readAgentWorkspaceInstructions(resolveAgentConfig(dir))).toBe(false);
  });
});
