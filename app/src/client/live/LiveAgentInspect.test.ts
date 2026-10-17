import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectParamRows, LiveAgentInspect } from "./LiveAgentInspect.tsx";

describe("LiveAgentInspect", () => {
  it("inspectParamRows skips empty fields", () => {
    const rows = inspectParamRows({
      name: "ops",
      displayName: "Ops Agent",
      roundLimit: 80,
      tools: ["reader"],
    });
    assert.deepEqual(
      rows.map((r) => r.label),
      ["显示名", "name", "round_limit", "tools"],
    );
    assert.equal(rows.find((r) => r.label === "tools")?.value, "reader");
  });

  it("inspectParamRows shows round_limit 0", () => {
    const rows = inspectParamRows({ name: "coding", roundLimit: 0 });
    assert.equal(rows.find((r) => r.label === "round_limit")?.value, "0");
  });

  it("renders params and prompt text", () => {
    const html = renderToStaticMarkup(
      createElement(LiveAgentInspect, { switchId: "system:ops" }),
    );
    assert.match(html, /data-live-agent-inspect/);
    assert.match(html, /系统提示词/);
  });
});
