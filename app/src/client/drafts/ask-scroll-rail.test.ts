import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASK_PREVIEW_MAX,
  ASK_GUTTER_PX,
  ASK_TRACK_INSET,
  askTickTop,
  canShowAskRail,
  clipAskPreview,
  layoutAskMarks,
  nearestTickTop,
  pointerOverAskGutter,
  scrollThumbLayout,
} from "./ask-scroll-rail";

describe("ask-scroll-rail", () => {
  it("clipAskPreview caps at 200 and keeps short text", () => {
    assert.equal(clipAskPreview("  hello  "), "hello");
    assert.equal(clipAskPreview(""), "");
    const long = "问".repeat(ASK_PREVIEW_MAX + 20);
    const clipped = clipAskPreview(long);
    assert.equal(clipped.length, ASK_PREVIEW_MAX);
    assert.equal(clipped.endsWith("…"), true);
  });

  it("track inset shortens the rail from both ends", () => {
    assert.equal(ASK_TRACK_INSET, 16);
  });

  it("canShowAskRail only when content overflows", () => {
    assert.equal(canShowAskRail(800, 800), false);
    assert.equal(canShowAskRail(801, 800), false);
    assert.equal(canShowAskRail(900, 800), true);
  });

  it("askTickTop maps content offset onto the track", () => {
    assert.equal(askTickTop(0, 1000, 200), 2);
    assert.equal(askTickTop(500, 1000, 200), 100);
  });

  it("scrollThumbLayout is null when no overflow", () => {
    assert.equal(scrollThumbLayout(0, 400, 400, 200), null);
  });

  it("scrollThumbLayout scales thumb and clamps top", () => {
    const mid = scrollThumbLayout(200, 1000, 400, 200);
    assert.ok(mid);
    assert.equal(mid.height, 80);
    assert.equal(mid.top, 40);
  });

  it("layoutAskMarks attaches track tops and clips preview", () => {
    const marks = layoutAskMarks(
      [
        { id: "u1", preview: "短问", offsetTop: 0 },
        { id: "u2", preview: "x".repeat(240), offsetTop: 500 },
      ],
      1000,
      200,
    );
    assert.equal(marks[0]!.top, 2);
    assert.equal(marks[1]!.top, 100);
    assert.equal(marks[1]!.preview.length, ASK_PREVIEW_MAX);
  });

  it("pointerOverAskGutter is the right strip of the thread", () => {
    const rect = { left: 0, right: 400, top: 40, bottom: 640 };
    assert.equal(pointerOverAskGutter(400, 100, rect), true);
    assert.equal(pointerOverAskGutter(400 - ASK_GUTTER_PX, 100, rect), true);
    assert.equal(pointerOverAskGutter(400 - ASK_GUTTER_PX - 1, 100, rect), false);
    assert.equal(pointerOverAskGutter(390, 20, rect), false);
  });

  it("nearestTickTop snaps within a generous band", () => {
    const tops = [40, 120, 300];
    assert.equal(nearestTickTop(tops, 42), 40);
    assert.equal(nearestTickTop(tops, 110), 120);
    assert.equal(nearestTickTop(tops, 134), 120);
    assert.equal(nearestTickTop(tops, 135), null);
    assert.equal(nearestTickTop([], 100), null);
  });
});
