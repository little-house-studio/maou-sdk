/**
 * WireTopbar 右上角今日 ↑in ↓out。
 * Run: pnpm exec tsx --test src/client/drafts/layout/WireTopbar.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WireTopbar } from "./WireTopbar";

describe("WireTopbar today tokens", () => {
  it("renders today kicker plus colored in/out arrows", () => {
    const html = renderToStaticMarkup(
      createElement(WireTopbar, {
        mode: "chat",
        onModeChange: () => {},
        todayInput: 1200,
        todayOutput: 500,
      }),
    );
    assert.match(html, /wire-meta-today/);
    assert.match(html, /wire-today-kicker/);
    assert.match(html, /今日/);
    assert.match(html, /↑ 1\.2K/);
    assert.match(html, /↓ 500/);
    assert.match(html, /wire-today-in/);
    assert.match(html, /wire-today-out/);
    assert.doesNotMatch(html, /wire-today-track|wire-today-fill|wire-today-row/);
    assert.doesNotMatch(html, /deepseek|gpt-5|yolo|auto|wire-meta-model/);
  });

  it("shows zeros when empty", () => {
    const html = renderToStaticMarkup(
      createElement(WireTopbar, {
        mode: "chat",
        onModeChange: () => {},
        todayInput: 0,
        todayOutput: 0,
      }),
    );
    assert.match(html, /↑ 0/);
    assert.match(html, /↓ 0/);
  });
});
