/**
 * Pure visual-mapping tests — drives shipped visual-marks.ts helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chromeMarkForMode,
  fileMarkKind,
  fileTone,
  hierarchyIndentPx,
  hierarchyMarkKind,
  hierarchyTone,
  roleLabelZh,
  roleMarkKind,
  roleTone,
  statusMarkKind,
  statusShape,
  statusTone,
  taskMarkKind,
} from "./visual-marks.ts";
import { fileIconKind } from "./file-tree.ts";
import { buildAgentListRows } from "./agent-tree.ts";

describe("visual-marks mappers", () => {
  it("maps agent presence statuses to distinct shape+tone pairs", () => {
    const kinds = [
      "idle",
      "running",
      "done_unread",
      "done_read",
      "blocked",
      "needs_reply",
    ] as const;
    const pairs = kinds.map((k) => {
      const mark = statusMarkKind(k);
      return `${statusShape(mark)}:${statusTone(mark)}`;
    });
    // running ≠ idle, blocked ≠ done
    assert.notEqual(
      statusShape(statusMarkKind("running")),
      statusShape(statusMarkKind("idle")),
    );
    assert.equal(statusTone(statusMarkKind("running")), "accent");
    assert.equal(statusTone(statusMarkKind("blocked")), "warn");
    assert.equal(statusTone(statusMarkKind("needs_reply")), "err");
    assert.equal(statusTone(statusMarkKind("done_unread")), "ok");
    assert.equal(new Set(pairs).size, pairs.length);
  });

  it("maps message roles to avatar kinds and labels", () => {
    assert.equal(roleMarkKind("user"), "user");
    assert.equal(roleTone("assistant"), "accent");
    assert.equal(roleTone("err"), "err");
    assert.equal(roleLabelZh("user"), "你");
    assert.equal(roleLabelZh("tool", "use_terminal"), "use_terminal");
  });

  it("maps hierarchy group/child to distinct marks", () => {
    assert.equal(
      hierarchyMarkKind({ group: "system", isChild: false }),
      "system_root",
    );
    assert.equal(
      hierarchyMarkKind({ group: "system", isChild: true }),
      "system_child",
    );
    assert.equal(
      hierarchyMarkKind({ group: "project", isChild: false }),
      "project_root",
    );
    assert.notEqual(
      hierarchyTone("system_root"),
      hierarchyTone("project_child"),
    );
    assert.equal(hierarchyIndentPx(0), 6);
    assert.equal(hierarchyIndentPx(2, 12, 6), 30);
  });

  it("delegates file marks to shipped fileIconKind", () => {
    assert.equal(fileMarkKind("App.tsx", false), fileIconKind("App.tsx", false));
    assert.equal(fileMarkKind("src", true, true), "folder-open");
    // colorful type map restored
    assert.equal(fileTone("tsx"), "info");
    assert.equal(fileTone("folder"), "warn");
    assert.equal(fileTone("git"), "err");
  });

  it("maps task status and chrome modes", () => {
    assert.equal(taskMarkKind("running"), "running");
    assert.equal(taskMarkKind("queued"), "queued");
    assert.equal(chromeMarkForMode("chat"), "mode_chat");
    assert.equal(chromeMarkForMode("team"), "mode_team");
    assert.equal(chromeMarkForMode("settings"), "settings");
  });

  it("agent-tree rows still carry hierarchy for visual indent", () => {
    const rows = buildAgentListRows([
      {
        id: "system:ops",
        name: "ops",
        status: "idle",
        group: "system",
      },
      {
        id: "system:ops::monitor",
        name: "monitor",
        status: "running",
        group: "system",
        parent: "ops",
      },
    ]);
    const child = rows.find((r) => r.kind === "agent" && r.depth === 1);
    assert.ok(child && child.kind === "agent");
    assert.equal(child.rowKind, "sub");
    assert.ok(hierarchyIndentPx(child.depth) > hierarchyIndentPx(0));
  });
});
