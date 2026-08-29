/**
 * 附属驻扎物化：nested under coding，list_in_manager=false
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import {
  ensureProactiveStationed,
  resolveProactiveStationDir,
} from "./station.js";
import { isStationedAffiliateAgentName } from "./defaults.js";

describe("ensureProactiveStationed", () => {
  const root = mkdtempSync(join(tmpdir(), "maou-proactive-station-"));
  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("materializes nested under coding/subagents/proactive", () => {
    const st = ensureProactiveStationed({ projectRoot: root });
    assert.equal(st.stationed, true);
    assert.equal(st.parentAgentName, "coding");
    assert.equal(st.agentName, "proactive");
    const expected = resolveProactiveStationDir(root);
    assert.equal(st.dir, expected);
    assert.ok(
      st.dir.includes(`${join("agents", "coding", "subagents", "proactive")}`),
    );
    assert.ok(existsSync(join(st.dir, "agent.json")));
    const json = JSON.parse(readFileSync(join(st.dir, "agent.json"), "utf8")) as {
      list_in_manager?: boolean;
      parent_agent?: string;
      scope?: string;
      stationed?: boolean;
    };
    assert.equal(json.list_in_manager, false);
    assert.equal(json.parent_agent, "coding");
    assert.equal(json.scope, "subagent");
    assert.equal(json.stationed, true);
    assert.equal(isStationedAffiliateAgentName("proactive"), true);
  });
});
