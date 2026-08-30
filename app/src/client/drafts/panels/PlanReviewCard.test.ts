/**
 * 计划审核卡：带框计划报告 + 阻塞/顾问两态。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanReviewCard, planReportHeading } from "./PlanReviewCard";

const noop = () => {};
const base = {
  markdown: "# 实施计划\n- 第一步\n- 第二步",
  objective: "把 plan 做成阻塞的",
  onStart: noop,
  onHold: noop,
};

const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(PlanReviewCard, { ...base, ...over } as never));

describe("planReportHeading", () => {
  it("uses the first markdown heading", () => {
    assert.equal(planReportHeading("# 实施计划\n- x", "其它目标"), "实施计划");
  });
});

describe("PlanReviewCard", () => {
  it("顾问态：开始计划 / 先不跑", () => {
    const html = render();
    assert.match(html, /计划报告/);
    assert.match(html, /开始计划/);
    assert.match(html, /先不跑/);
    assert.match(html, /data-plan-blocking="false"/);
    assert.match(html, /待确认/);
    assert.match(html, /需要你确认后才会执行/);
    assert.doesNotMatch(html, /确认执行/);
    assert.doesNotMatch(html, /去聊天里说/);
  });

  it("阻塞态：框住的报告含标题和正文预览", () => {
    const html = render({ blocking: true, revision: 3 });
    assert.match(html, /计划报告/);
    assert.match(html, /plan-review-heading/);
    assert.match(html, /实施计划/);
    assert.match(html, /plan-review-preview/);
    assert.match(html, /第一步/);
    assert.match(html, /确认执行/);
    assert.match(html, /拒绝/);
    assert.match(html, /补充意见/);
    assert.match(html, /进度已暂停/);
    assert.match(html, /必须审核/);
    assert.doesNotMatch(html, /is-collapsed/);
    assert.doesNotMatch(html, /去聊天里说/);
    assert.match(html, /data-plan-blocking="true"/);
    assert.match(html, /v3/);
    assert.match(html, /放大/);
  });

  it("阻塞态的按钮全部可点（busy 只属于顾问态的 /plan approve 往返）", () => {
    const html = render({ blocking: true });
    assert.doesNotMatch(html, /disabled/);
  });

  it("已同意：一行标题灰卡，查看全文，没有操作钮", () => {
    const html = render({ settled: "approve", revision: 2 });
    assert.match(html, /is-settled-approve/);
    assert.match(html, /已同意/);
    assert.match(html, /实施计划/);
    assert.match(html, />查看</);
    assert.doesNotMatch(html, /plan-review-preview/);
    assert.doesNotMatch(html, /plan-review-actions/);
    assert.doesNotMatch(html, /开始计划/);
    assert.doesNotMatch(html, /data-plan-blocking="true"/);
  });

  it("已拒绝 / 已反馈 / 先不跑用不同 settled class", () => {
    assert.match(render({ settled: "reject" }), /is-settled-reject/);
    assert.match(render({ settled: "reject" }), /已拒绝/);
    assert.match(render({ settled: "chat" }), /is-settled-chat/);
    assert.match(render({ settled: "chat" }), /已反馈/);
    assert.match(render({ settled: "hold" }), /is-settled-hold/);
    assert.match(render({ settled: "hold" }), /先不跑/);
  });
});
