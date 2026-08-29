/**
 * WireTopbar 右上角今日 token 一行字。
 * Run: pnpm exec tsx --test src/client/drafts/layout/WireTopbar.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WireTopbar } from "./WireTopbar";

describe("WireTopbar today tokens", () => {
  it("renders one text line and not model or approval", () => {
    const html = renderToStaticMarkup(
      createElement(WireTopbar, {
        mode: "chat",
        onModeChange: () => {},
        todayInput: 1200,
        todayOutput: 500,
      }),
    );
    assert.match(html, /wire-meta-today/);
    assert.match(html, /今日 1\.2k \/ 500/);
    assert.doesNotMatch(html, /wire-today-track|wire-today-fill|wire-today-row/);
    assert.doesNotMatch(html, /↑|↓/);
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
    assert.match(html, /今日 0 \/ 0/);
  });
});
