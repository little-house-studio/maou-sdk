/**
 * 计划审核卡两态：阻塞（有人等答案）与顾问（只是提醒）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanReviewCard } from "./PlanReviewCard";

const noop = () => {};
const base = {
  markdown: "# 实施计划\n- 第一步\n- 第二步",
  objective: "把 plan 做成阻塞的",
  onStart: noop,
  onHold: noop,
};

const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(PlanReviewCard, { ...base, ...over } as never));

describe("PlanReviewCard", () => {
  it("顾问态：开始计划 / 先不跑，可收起", () => {
    const html = render();
    assert.match(html, /审阅计划/);
    assert.match(html, /开始计划/);
    assert.match(html, /先不跑/);
    assert.match(html, /data-plan-blocking="false"/);
    assert.match(html, /role="region"/);
    // 顾问态不抢键盘，也不摆快捷键
    assert.doesNotMatch(html, /plan-review-keys/);
    assert.doesNotMatch(html, /确认执行/);
  });

  it("阻塞态：三选一，没有「先不跑」这条会把工具悬住的出口", () => {
    const html = render({ blocking: true, revision: 3 });
    assert.match(html, /计划待审/);
    assert.match(html, /确认执行/);
    assert.match(html, /拒绝/);
    assert.match(html, /去聊天里说/);
    assert.doesNotMatch(html, /先不跑/);
    assert.match(html, /data-plan-blocking="true"/);
    assert.match(html, /role="alertdialog"/);
    assert.match(html, /is-blocking/);
    assert.match(html, /v3/);
    assert.match(html, /1–3 · Esc 去聊天里说/);
  });

  it("两态都渲染计划正文；compact 只留动作", () => {
    assert.match(render({ blocking: true }), /实施计划/);
    assert.match(render(), /实施计划/);
    const dock = render({ blocking: true, compact: true });
    assert.doesNotMatch(dock, /实施计划/);
    assert.match(dock, /确认执行/);
    // compact 是同一张卡的第二个实例，不能再摆一遍快捷键
    assert.doesNotMatch(dock, /plan-review-keys/);
  });

  it("空正文说实话，不装作有内容", () => {
    const html = render({ markdown: "   ", blocking: true });
    assert.match(html, /这一版计划没有正文/);
  });

  it("阻塞态的按钮全部可点（busy 只属于顾问态的 /plan approve 往返）", () => {
    const html = render({ blocking: true });
    assert.doesNotMatch(html, /disabled/);
  });
});
