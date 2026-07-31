/**
 * CLI jump-prev-user pure helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPrevUserJumpLabel,
  findOlderUserIndex,
  measureScrollFromBottom,
  pickOlderUser,
  scrollTopToAlignMessage,
  shouldShowBackToBottom,
  shouldShowJumpBar,
  shouldStickToBottom,
  STICK_TO_BOTTOM_PX,
} from "./jump-prev-user";

describe("jump-prev-user CLI helpers", () => {
  it("show_jump when scrolled up past threshold (CLI >2 rows)", () => {
    assert.equal(shouldShowJumpBar(false, 0), false);
    assert.equal(shouldShowJumpBar(false, 10), false);
    assert.equal(shouldShowJumpBar(false, 25), true);
    assert.equal(shouldShowJumpBar(true, 100), false);
  });

  it("show_back when not empty and not glued to bottom", () => {
    assert.equal(shouldShowBackToBottom(false, 0), false);
    assert.equal(shouldShowBackToBottom(false, 3), true);
    assert.equal(shouldShowBackToBottom(true, 3), false);
  });

  it("shouldStickToBottom is looser than jump bar hide for live pin", () => {
    assert.equal(shouldStickToBottom(0), true);
    assert.equal(shouldStickToBottom(STICK_TO_BOTTOM_PX), true);
    assert.equal(shouldStickToBottom(STICK_TO_BOTTOM_PX + 1), false);
    assert.ok(STICK_TO_BOTTOM_PX > 24);
  });

  it("findOlderUserIndex matches CLI scroll-math cases", () => {
    const isUser = [true, false, true, false];
    const starts = [0, 5, 15, 20];
    const heights = [4, 9, 4, 4];
    assert.equal(findOlderUserIndex(isUser, starts, heights, 14), 0);
    assert.equal(findOlderUserIndex(isUser, starts, heights, 15), 0);
    assert.equal(findOlderUserIndex(isUser, starts, heights, 20), 2);
    assert.equal(findOlderUserIndex(isUser, starts, heights, 0), -1);
  });

  it("pickOlderUser returns last fully-above user layout entry", () => {
    const users = [
      { id: "u0", body: "first", top: 0, height: 40 },
      { id: "u1", body: "second hello", top: 200, height: 40 },
    ];
    assert.equal(pickOlderUser(users, 0), null);
    assert.equal(pickOlderUser(users, 50)?.id, "u0");
    assert.equal(pickOlderUser(users, 250)?.id, "u1");
  });

  it("buildPrevUserJumpLabel previews body like CLI", () => {
    assert.equal(buildPrevUserJumpLabel(""), "↑ 上一条 user（点击）");
    assert.equal(buildPrevUserJumpLabel("  hi  "), "↑ hi");
    const long = "x".repeat(80);
    const lab = buildPrevUserJumpLabel(long, 20);
    assert.ok(lab.startsWith("↑ "));
    assert.ok(lab.endsWith("…"));
    assert.ok(lab.length <= 24);
  });

  it("scrollTopToAlignMessage pins target near top", () => {
    assert.equal(scrollTopToAlignMessage(150, 400), 150);
    assert.equal(scrollTopToAlignMessage(0, 400), 0);
    assert.equal(scrollTopToAlignMessage(500, 400), 400);
  });

  it("measureScrollFromBottom from element metrics", () => {
    assert.equal(
      measureScrollFromBottom({
        scrollHeight: 1000,
        scrollTop: 200,
        clientHeight: 300,
      }),
      500,
    );
  });
});
