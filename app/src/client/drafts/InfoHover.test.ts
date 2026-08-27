/**
 * InfoHover closed-state markup (panel portals only while open).
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { InfoHover } from "./InfoHover";

describe("InfoHover", () => {
  it("renders the anchor with an aria label and does not mount the panel closed", () => {
    const html = renderToStaticMarkup(
      createElement(
        InfoHover,
        {
          rows: [
            { label: "轮次", value: "3" },
            { label: "工具", value: "2" },
          ],
          label: "第 3 轮",
        },
        createElement("span", { className: "wire-round-chip" }, "3"),
      ),
    );
    assert.match(html, /data-hover-tip=/);
    assert.match(html, /wire-info-hover/);
    assert.match(html, /aria-label="第 3 轮"/);
    assert.match(html, /wire-round-chip/);
    assert.doesNotMatch(html, /data-hover-tip-panel=/);
    assert.doesNotMatch(html, /data-info-hover-panel=/);
    assert.doesNotMatch(html, /title=/);
  });

  it("passes through children when there are no rows", () => {
    const html = renderToStaticMarkup(
      createElement(
        InfoHover,
        { rows: [] },
        createElement("span", { className: "only-child" }, "x"),
      ),
    );
    assert.match(html, /only-child/);
    assert.doesNotMatch(html, /data-hover-tip=/);
  });
});
