/**
 * HoverTip closed-state markup + open-delay contract.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { HoverTip, HOVER_TIP_OPEN_MS } from "./HoverTip";

describe("HoverTip", () => {
  it("defaults to a 100ms open delay", () => {
    assert.equal(HOVER_TIP_OPEN_MS, 100);
  });

  it("renders the anchor closed; panel portals only while open", () => {
    const html = renderToStaticMarkup(
      createElement(
        HoverTip,
        { content: "提问全文", label: "预览" },
        createElement("span", { className: "wire-ask-tick-anchor" }, "—"),
      ),
    );
    assert.match(html, /data-hover-tip=/);
    assert.match(html, /aria-label="预览"/);
    assert.doesNotMatch(html, /data-hover-tip-panel=/);
    assert.doesNotMatch(html, /title=/);
  });

  it("passes through children when there is no content", () => {
    const html = renderToStaticMarkup(
      createElement(
        HoverTip,
        { content: null },
        createElement("span", { className: "only-child" }, "x"),
      ),
    );
    assert.match(html, /only-child/);
    assert.doesNotMatch(html, /data-hover-tip=/);
  });
});
