/**
 * 顶栏活动 Agent 列表。
 * Run: pnpm exec tsx --test src/client/wire/chrome/activity-agents.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activityRowLabel,
  buildActivityMenu,
  summarizeActivityChip,
} from "./activity-agents.js";

describe("activity agent menu", () => {
  it("puts OPS first and lists background coding", () => {
    const items = buildActivityMenu({
      home: { switchId: "system:ops", agent: "ops", displayName: "OPS" },
      currentSwitchId: "system:ops",
      activity: [
        {
          id: "c1",
          switchId: "project:/p:coding",
          agent: "coding",
          displayName: "Coding",
          projectName: "app",
          sessionId: "s1",
          status: "running",
        },
      ],
    });
    assert.equal(items[0]?.switchId, "system:ops");
    assert.equal(items[0]?.current, true);
    assert.equal(items[1]?.status, "running");
    assert.equal(summarizeActivityChip(items).label, "Coding · 运行中");
    assert.equal(summarizeActivityChip(items).live, true);
    assert.match(activityRowLabel(items[1]!), /Coding · app · 运行中/);
  });

  it("keeps finished agents visible on the chip", () => {
    const items = buildActivityMenu({
      home: { switchId: "system:ops", agent: "ops", displayName: "OPS" },
      currentSwitchId: "system:ops",
      activity: [
        {
          id: "c1",
          switchId: "project:/p:coding",
          agent: "coding",
          displayName: "Coding",
          projectName: "app",
          sessionId: "s1",
          status: "done",
        },
      ],
    });
    assert.equal(summarizeActivityChip(items).label, "Coding · 已完成");
  });
});
