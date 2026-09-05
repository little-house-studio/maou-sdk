/**
 * Live adapter pure mappers — production wiring for draft chrome props.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Meta, TerminalInfo } from "../api";
import {
  liveAgentsToDraftAgents,
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

  it("metaToAgents reflects busy status (fallback single row)", () => {
    const idle = metaToAgents(sampleMeta, false);
    assert.equal(idle.length, 1);
    assert.equal(idle[0]!.status, "idle");
    assert.equal(idle[0]!.name, "coding");
    const busy = metaToAgents(sampleMeta, true);
    assert.equal(busy[0]!.status, "running");
  });

  it("liveAgentsToDraftAgents maps multi-agent registry rows", () => {
    const list = liveAgentsToDraftAgents(
      [
        {
          id: "system:coding",
          name: "coding",
          displayName: "Coding",
          role: "coding",
          status: "idle",
          group: "system",
        },
        {
          id: "system:coding:ops",
          name: "ops",
          displayName: "Ops",
          role: "ops",
          status: "blocked",
          group: "system",
          parent: "coding",
        },
        {
          id: "project:/p:explore",
          name: "explore",
          displayName: "Explore",
          role: "explore",
          status: "running",
          group: "project",
          projectPath: "/p",
          projectName: "p",
        },
      ],
      { activeAgentName: "coding", agentBusy: true },
    );
    assert.equal(list.length, 3);
    assert.equal(list[0]!.status, "running"); // busy active
    assert.equal(list[1]!.parent, "coding");
    assert.equal(list[2]!.group, "project");
  });

  it("liveAgentsToDraftAgents drops install", () => {
    const list = liveAgentsToDraftAgents([
      {
        id: "system:ops",
        name: "ops",
        displayName: "Ops Agent",
        group: "system",
      },
      {
        id: "system:install",
        name: "install",
        displayName: "Install Agent",
        group: "system",
      },
    ]);
    assert.deepEqual(
      list.map((a) => a.name),
      ["ops"],
    );
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
