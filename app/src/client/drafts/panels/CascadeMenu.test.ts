import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { CascadeMenu } from "./CascadeMenu";

describe("CascadeMenu", () => {
  it("renders a single trigger, not the panel, when closed", () => {
    const html = renderToStaticMarkup(
      createElement(CascadeMenu, {
        triggerLabel: "放行",
        ariaLabel: "审批模式",
        columns: [
          {
            key: "mode",
            items: [
              { id: "yolo", label: "放行", selected: true },
              { id: "auto", label: "自动" },
            ],
          },
        ],
      }),
    );
    assert.match(html, /data-cascade-menu=/);
    assert.match(html, /wire-cascade-trigger/);
    assert.match(html, /放行/);
    assert.doesNotMatch(html, /data-cascade-panel=/);
    assert.doesNotMatch(html, /自动/);
  });
});
