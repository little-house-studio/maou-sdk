/**
 * inspect 只转发 preview + resolveAgentConfig，不自写编译。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  inspectAgentFromDisk,
  pickAgentInspectParams,
  resolveInspectTarget,
} from "./agent-inspect.ts";

describe("agent-inspect", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("pickAgentInspectParams reads resolveAgentConfig keys only", () => {
    const p = pickAgentInspectParams({
      name: "ops",
      display_name: "Ops Agent",
      role: "ops",
      scope: "global",
      round_limit: 80,
      tools: ["use_terminal", "reader"],
      workspace_instructions: false,
      junk: "drop",
    });
    assert.equal(p.name, "ops");
    assert.equal(p.displayName, "Ops Agent");
    assert.equal(p.roundLimit, 80);
    assert.deepEqual(p.tools, ["use_terminal", "reader"]);
    assert.equal(p.workspaceInstructions, false);
    assert.equal(p.terminalMode, undefined);
  });

  it("pickAgentInspectParams keeps round_limit 0", () => {
    const p = pickAgentInspectParams({ name: "coding", round_limit: 0 });
    assert.equal(p.roundLimit, 0);
  });

  it("resolveInspectTarget uses parseAgentSwitchId + resolveWorkspaceForSwitch", () => {
    const maou = mkdtempSync(join(tmpdir(), "maou-inspect-"));
    dirs.push(maou);
    mkdirSync(join(maou, "ops"), { recursive: true });
    const current = {
      agentName: "coding",
      projectRoot: "/proj",
      switchId: "project:/proj:coding",
    };
    const ops = resolveInspectTarget(current, {
      maouRoot: maou,
      bootProjectRoot: "/boot",
      switchId: "system:ops",
    });
    assert.equal(ops.agentName, "ops");
    assert.equal(ops.switchId, "system:ops");
    assert.equal(ops.projectRoot, join(maou, "ops"));

    const proj = resolveInspectTarget(current, {
      maouRoot: maou,
      bootProjectRoot: "/boot",
      switchId: "project:/Users/me/game:coding",
    });
    assert.equal(proj.agentName, "coding");
    assert.equal(proj.projectRoot, "/Users/me/game");
    assert.equal(proj.switchId, "project:/Users/me/game:coding");
  });

  it("inspectAgentFromDisk compiles via previewAgentSystemPrompt", () => {
    const maou = mkdtempSync(join(tmpdir(), "maou-inspect-disk-"));
    dirs.push(maou);
    const agentDir = join(maou, "agents", "demo");
    mkdirSync(join(agentDir, "prompt", "system"), { recursive: true });
    writeFileSync(
      join(agentDir, "agent.json"),
      JSON.stringify({
        name: "demo",
        display_name: "Demo",
        role: "ops",
        round_limit: 12,
        tools: ["reader"],
      }),
      "utf-8",
    );
    writeFileSync(join(agentDir, "prompt", "system", "system.md"), "INSPECT_MARKER\n", "utf-8");

    const snap = inspectAgentFromDisk({
      maouRoot: maou,
      agentName: "demo",
      projectRoot: maou,
      switchId: "system:demo",
    });
    assert.equal(snap.params.displayName, "Demo");
    assert.equal(snap.params.roundLimit, 12);
    assert.equal(snap.prompt.ok, true);
    assert.match(snap.prompt.text, /INSPECT_MARKER/);
    assert.ok(snap.prompt.charCount > 0);
  });

  it("inspectAgentFromDisk reports error when prompt is missing", () => {
    const maou = mkdtempSync(join(tmpdir(), "maou-inspect-miss-"));
    dirs.push(maou);
    const snap = inspectAgentFromDisk({
      maouRoot: maou,
      agentName: "ghost",
      projectRoot: maou,
      switchId: "system:ghost",
    });
    assert.equal(snap.prompt.ok, false);
    assert.ok(snap.prompt.error);
  });
});
