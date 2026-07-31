/**
 * Live adapter pure mappers — production wiring for draft chrome props.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Meta, TerminalInfo } from "../api";
import {
  metaToAgents,
  metaToDraftMeta,
  projectLabelFromRoot,
  projectPathLabel,
  terminalsToBgTasks,
  terminalsToTermLines,
  usageLabelFromMeta,
} from "./adapters";

const sampleMeta: Meta = {
  sessionId: "sess-1",
  provider: "openai",
  model: "gpt-test",
  projectRoot: "/Users/me/work/maou-sdk",
  sandboxMode: "normal",
  approvalMode: "auto",
  agentName: "coding",
};

describe("live adapters", () => {
  it("project labels slice last two path segments", () => {
    assert.equal(projectLabelFromRoot("/a/b/c/d"), "c/d");
    assert.equal(projectPathLabel("/a/b/c/d"), "~/c/d");
    assert.equal(projectLabelFromRoot(undefined), "project");
  });

  it("metaToDraftMeta maps live Meta for WireTopbar/BottomInfoBar", () => {
    const d = metaToDraftMeta(sampleMeta);
    assert.equal(d.agentName, "coding");
    assert.equal(d.model, "gpt-test");
    assert.equal(d.provider, "openai");
    assert.equal(d.sandboxMode, "auto");
    assert.equal(d.projectLabel, "work/maou-sdk");
    assert.equal(d.offline, false);
  });

  it("metaToDraftMeta offline null meta", () => {
    const d = metaToDraftMeta(null);
    assert.equal(d.offline, true);
    assert.equal(d.agentName, "coding");
  });

  it("metaToAgents reflects busy status", () => {
    const idle = metaToAgents(sampleMeta, false);
    assert.equal(idle.length, 1);
    assert.equal(idle[0]!.status, "idle");
    assert.equal(idle[0]!.name, "coding");
    const busy = metaToAgents(sampleMeta, true);
    assert.equal(busy[0]!.status, "running");
  });

  it("terminalsToTermLines and bgTasks from TerminalInfo", () => {
    const terms: TerminalInfo[] = [
      {
        id: "t1",
        agentName: "coding",
        command: "pnpm test",
        description: "run tests",
        state: "running",
        exitCode: null,
        cwd: "/tmp",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "t2",
        agentName: "coding",
        command: "echo done",
        description: "echo",
        state: "exited",
        exitCode: 0,
        cwd: "/tmp",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const lines = terminalsToTermLines(terms);
    assert.ok(lines[0]!.includes("running"));
    assert.ok(lines[0]!.includes("coding"));
    const tasks = terminalsToBgTasks(terms);
    assert.equal(tasks[0]!.status, "running");
    assert.equal(tasks[1]!.status, "done");
  });

  it("usageLabelFromMeta covers busy/offline/ready", () => {
    assert.equal(usageLabelFromMeta(null, false), "connecting…");
    assert.equal(usageLabelFromMeta(sampleMeta, true), "running");
    assert.equal(usageLabelFromMeta(sampleMeta, false), "auto");
  });
});
