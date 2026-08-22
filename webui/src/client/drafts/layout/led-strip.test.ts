import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LedStrip } from "./LedStrip";
import {
  LED_COLS,
  LED_ROWS,
  ledStateLabel,
  resolveLedState,
} from "./led-strip";

describe("led-strip", () => {
  it("maps busy/offline to run/off/idle", () => {
    assert.equal(resolveLedState({ busy: true }), "run");
    assert.equal(resolveLedState({ offline: true }), "off");
    assert.equal(resolveLedState({ busy: true, offline: true }), "off");
    assert.equal(resolveLedState({}), "idle");
  });

  it("renders 3×18 cells and exposes state", () => {
    const html = renderToStaticMarkup(
      createElement(LedStrip, { state: "run" }),
    );
    assert.match(html, /data-led-strip="3x18"/);
    assert.match(html, /data-state="run"/);
    assert.match(html, /aria-label="Agent 运行中"/);
    assert.equal((html.match(/wire-led-cell/g) ?? []).length, LED_ROWS * LED_COLS);
    assert.equal(ledStateLabel("idle"), "Agent 空闲");
    assert.equal(ledStateLabel("off"), "离线");
  });
});
