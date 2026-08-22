/**
 * Bottom dock folder paths + physics.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCK_CLICK_SLOP_PX,
  DOCK_EXPAND_H_UI,
  DOCK_EXPAND_W_UI,
  DOCK_OPEN_THRESHOLD,
  DOCK_BREAKAWAY_RAW,
  DOCK_DETENT_PEEK,
  STOW_EASE_S,
  DOCK_PREVIEW_W_MIN,
  DOCK_TAB_H,
  DOCK_TAB_W,
  DOCK_STRIP_BODY_H,
  DOCK_EAR_RISE_H,
  DOCK_TRACK_H,
  FOLDER,
  FOLDER_PATH_EXPAND,
  FOLDER_PATH_PREVIEW,
  FOLDER_PATH_TAB,
  FOLDER_SCALE,
  applyDockDragMove,
  bottomYFromCssHeight,
  buildFolderPath,
  createDockDragSession,
  displayPullHeight,
  detentPull,
  isPullBreakaway,
  easeCloseProgress,
  easeCloseHeight,
  displayResizeHeight,
  dockCardWidth,
  folderViewBox,
  isClickGesture,
  pullFromPointer,
  releaseResizeTarget,
  releaseTarget,
  resolveDockPointerUp,
  rightXFromCssWidth,
  rubberBand,
  reorderDockOrder,
  defaultDockOrder,
  dockTabZIndex,
  shouldStowFloat,
  boardPlacementFromSlot,
  boardTopFromSlotBottom,
  boardWidthForPanel,
  boardHeightForPanel,
  lerpBoardPos,
  stowProgressFromHeight,
  boardTiltDeg,
  stepHoverProgress,
  stepHoverMap,
  hoverTextOpacity,
  stripWidthForHoverProgress,
  dockMagnetWeight,
  dockMagnetWinner,
  dockMagnetPose,
  dockMagnetTransform,
  lerpMagnetPose,
  magnetPoseSettled,
  DOCK_MAGNET_REST,
  DOCK_MAGNET_MAX_RISE,
  DOCK_MAGNET_HOLD_PX,
  springSettled,
  springStep,
  SPRING_OPEN,
  OPEN_KICK_V,
} from "./bottom-dock";

describe("folder path geometry (design SVGs → content-local)", () => {
  it("tab / preview / expand paths match design topology", () => {
    // Content-local (origin shifted −3.5,−3.5 from design)
    assert.equal(FOLDER_PATH_TAB, "M0 1V4H11.5V1H10.5L9.5 0H1L0 1Z");
    assert.equal(FOLDER_PATH_PREVIEW, "M0 1V4H43.5V1H10.5L9.5 0H1L0 1Z");
    assert.equal(FOLDER_PATH_EXPAND, "M0 1V34H34.5V1H10.5L9.5 0H1L0 1Z");
  });

  it("only right + bottom scale; ear fixed", () => {
    const wide = buildFolderPath(60, 4);
    assert.equal(wide, "M0 1V4H60V1H10.5L9.5 0H1L0 1Z");
    const tall = buildFolderPath(34.5, 50);
    assert.equal(tall, "M0 1V50H34.5V1H10.5L9.5 0H1L0 1Z");
  });

  it("tight viewBox fills CSS box (no empty filter pad)", () => {
    assert.equal(folderViewBox(11.5, 4), "0 0 11.5 4");
    assert.equal(folderViewBox(43.5, 4), "0 0 43.5 4");
    assert.equal(folderViewBox(34.5, 34), "0 0 34.5 34");
  });

  it("scale maps content units to CSS px", () => {
    assert.equal(FOLDER_SCALE, 8);
    assert.equal(DOCK_TAB_W, Math.round(11.5 * 8));
    assert.ok(dockCardWidth("preview") >= DOCK_PREVIEW_W_MIN);
    assert.equal(dockCardWidth("expand"), DOCK_EXPAND_W_UI);
    assert.ok(rightXFromCssWidth(DOCK_TAB_W) >= FOLDER.tabRight - 0.1);
  });

  it("strip body height aligns with fold shoulder, not ear tip", () => {
    // ear y=0..1, body y=1..4 → body is 3/4 of full track
    assert.equal(DOCK_TRACK_H, 32);
    assert.equal(DOCK_STRIP_BODY_H, 24);
    assert.equal(DOCK_EAR_RISE_H, 8);
    assert.equal(
      DOCK_STRIP_BODY_H,
      Math.round((FOLDER.stripBottom - FOLDER.bodyTop) * FOLDER_SCALE),
    );
    assert.equal(DOCK_EAR_RISE_H + DOCK_STRIP_BODY_H, DOCK_TRACK_H);
    assert.ok(DOCK_STRIP_BODY_H < DOCK_TRACK_H);
  });
});

describe("bottom-dock rubber + spring", () => {
  it("rubberBand compresses overshoot", () => {
    assert.equal(rubberBand(100, 200), 100);
    const past = rubberBand(400, 200);
    assert.ok(past > 200 && past < 400);
  });

  it("displayPullHeight / spring / release", () => {
    assert.ok(displayPullHeight(DOCK_EXPAND_H_UI / 2) < DOCK_EXPAND_H_UI / 2);
    let s = { x: 0, v: 480 };
    for (let i = 0; i < 180; i++) s = springStep(s, DOCK_EXPAND_H_UI, 16, SPRING_OPEN);
    assert.ok(springSettled(s, DOCK_EXPAND_H_UI, 3, 25));
    assert.equal(releaseTarget(10, 0).open, false);
    assert.equal(releaseTarget(DOCK_OPEN_THRESHOLD, 0).open, true);
    assert.equal(releaseTarget(DOCK_BREAKAWAY_RAW - 1, 2).open, false);
    assert.equal(releaseResizeTarget(20, 0).open, false);
  });

  it("detent pull lags the pointer then breakaway commits", () => {
    assert.ok(DOCK_BREAKAWAY_RAW > DOCK_EXPAND_H_UI * 0.5);
    assert.ok(DOCK_DETENT_PEEK < DOCK_EXPAND_H_UI * 0.4);
    const half = DOCK_EXPAND_H_UI / 2;
    const shown = detentPull(half);
    assert.ok(shown < half * 0.7, "board stays low near halfway");
    assert.ok(shown < detentPull(DOCK_BREAKAWAY_RAW));
    assert.equal(isPullBreakaway(half), false);
    assert.equal(isPullBreakaway(DOCK_BREAKAWAY_RAW), true);
    assert.equal(displayPullHeight(half), detentPull(half));
    assert.equal(easeCloseHeight(200, 0), 200);
    assert.equal(easeCloseHeight(200, 1), 0);
    assert.ok(easeCloseHeight(200, 0.5) > 0 && easeCloseHeight(200, 0.5) < 200);
    assert.equal(easeCloseProgress(0), 0);
    assert.equal(easeCloseProgress(STOW_EASE_S), 1);
  });

  it("gesture helpers", () => {
    assert.equal(isClickGesture(0), true);
    assert.equal(isClickGesture(DOCK_CLICK_SLOP_PX + 5), false);
    assert.equal(pullFromPointer(400, 350), 50);
    assert.equal(displayResizeHeight(200, 500, 450), 250);
    assert.ok(bottomYFromCssHeight(200) >= FOLDER.stripBottom);
  });
});

describe("bottom-dock pointer machine", () => {
  it("open drag and click paths", () => {
    let s = createDockDragSession("agent", "open", 1, 500, 0, 0);
    const shy = applyDockDragMove(s, 500 - 80, 48);
    assert.equal(shy.session.moved, true);
    assert.equal(shy.breakaway, false);
    assert.ok(shy.height < shy.raw);
    const shyEnd = resolveDockPointerUp(
      shy.session,
      null,
      shy.height,
      500 - 80,
    );
    assert.equal(shyEnd.open, false);

    const resume = createDockDragSession("agent", "open", 1, 500, 40, 0);
    const resumeMove = applyDockDragMove(resume, 500 - 20, 48);
    assert.ok(resumeMove.height >= 40, "interrupted close must not drop height");

    let m = applyDockDragMove(s, 500 - DOCK_BREAKAWAY_RAW, 48);
    assert.equal(m.breakaway, true);
    const end = resolveDockPointerUp(
      m.session,
      null,
      m.height,
      500 - DOCK_BREAKAWAY_RAW,
    );
    assert.equal(end.open, true);

    const click = resolveDockPointerUp(
      createDockDragSession("logs", "open", 1, 400, 0, 0),
      null,
      0,
      400,
    );
    assert.equal(click.kind, "click-open");

    const earClose = resolveDockPointerUp(
      createDockDragSession("logs", "resize", 1, 400, DOCK_EXPAND_H_UI, 0),
      "logs",
      DOCK_EXPAND_H_UI,
      400,
    );
    assert.equal(earClose.kind, "click-close");
  });

  it("micro-drag on another tab freezes height then spring-switches (no silent close)", () => {
    // Card "logs" already open; press "agent" and jiggle within slop → click-switch
    const clickSwitch = resolveDockPointerUp(
      createDockDragSession("agent", "open", 1, 400, DOCK_EXPAND_H_UI, 0),
      "logs",
      DOCK_EXPAND_H_UI,
      400,
    );
    assert.equal(clickSwitch.kind, "click-switch");
    assert.equal(clickSwitch.open, true);
    assert.equal(clickSwitch.id, "agent");
    assert.ok(clickSwitch.targetH >= DOCK_EXPAND_H_UI);

    // Micro-drag past slop while another card is open: freeze height during move
    let s = createDockDragSession("agent", "open", 1, 500, DOCK_EXPAND_H_UI, 0);
    let m = applyDockDragMove(s, 500 - 20, 40, { alreadyOpenId: "logs" });
    assert.equal(m.session.moved, true);
    assert.equal(m.freezeHeight, true);
    assert.equal(m.height, DOCK_EXPAND_H_UI);
    const end = resolveDockPointerUp(
      m.session,
      "logs",
      DOCK_EXPAND_H_UI,
      500 - 20,
    );
    assert.equal(end.kind, "spring-switch");
    assert.equal(end.open, true);
    assert.equal(end.id, "agent");
  });

  it("reorder / stow / rightmost z-index", () => {
    const order = defaultDockOrder();
    assert.equal(reorderDockOrder(order, "logs", 4).at(-1), "logs");
    assert.equal(shouldStowFloat(790, 800), true);
    assert.ok(dockTabZIndex(4, 5) > dockTabZIndex(1, 5));
  });

  it("board lift places bottom on slot; width morphs; stow lerp", () => {
    assert.equal(boardTopFromSlotBottom(500, 100), 400);
    const p = boardPlacementFromSlot(
      { left: 40, bottom: 700 },
      200,
      150,
      1000,
      800,
    );
    assert.equal(p.left, 40);
    assert.equal(p.top, 550);
    const w0 = boardWidthForPanel(0);
    const w1 = boardWidthForPanel(200);
    assert.equal(w0, DOCK_TAB_W);
    assert.equal(w1, DOCK_EXPAND_W_UI);
    assert.equal(boardHeightForPanel(100), DOCK_TAB_H + 100);
    assert.deepEqual(
      lerpBoardPos({ left: 0, top: 0 }, { left: 100, top: 50 }, 0.25),
      { left: 25, top: 12.5 },
    );
    assert.ok(stowProgressFromHeight(50, 200) > 0.5);
    assert.ok(Math.abs(boardTiltDeg(-80)) <= 5);
    assert.ok(OPEN_KICK_V >= 600);
  });

  it("hover strip: right edge grows then text reveals (label stays)", () => {
    assert.equal(stripWidthForHoverProgress(0, DOCK_PREVIEW_W_MIN), DOCK_TAB_W);
    assert.equal(
      stripWidthForHoverProgress(1, DOCK_PREVIEW_W_MIN),
      DOCK_PREVIEW_W_MIN,
    );
    const mid = stripWidthForHoverProgress(0.5, DOCK_PREVIEW_W_MIN);
    assert.ok(mid > DOCK_TAB_W && mid < DOCK_PREVIEW_W_MIN);
    assert.equal(hoverTextOpacity(0), 0);
    assert.ok(hoverTextOpacity(0.1) === 0 || hoverTextOpacity(0.1) < 0.05);
    assert.ok(hoverTextOpacity(0.5) > 0.2);
    assert.ok(hoverTextOpacity(1) > 0.95);
    let t = 0;
    t = stepHoverProgress(t, 1, 0.05);
    assert.ok(t > 0 && t < 1);
    t = stepHoverProgress(0.99, 1, 0.05);
    assert.equal(t, 1);
    t = stepHoverProgress(1, 0, 0.05);
    assert.ok(t < 1);
  });

  it("magnet: gaussian pull, hysteresis winner, peek pose, sweep map", () => {
    assert.ok(dockMagnetWeight(100, 100) > 0.99);
    assert.ok(dockMagnetWeight(100, 200) < dockMagnetWeight(100, 140));

    const slots = [
      { id: "logs" as const, center: 100 },
      { id: "tasks" as const, center: 200 },
    ];
    assert.equal(dockMagnetWinner(slots, 105), "logs");
    assert.equal(dockMagnetWinner(slots, 190), "tasks");
    // seam: stay on prev until holdPx past midpoint (150)
    assert.equal(
      dockMagnetWinner(slots, 155, "logs", DOCK_MAGNET_HOLD_PX),
      "logs",
    );
    assert.equal(
      dockMagnetWinner(slots, 175, "logs", DOCK_MAGNET_HOLD_PX),
      "tasks",
    );

    const rest = dockMagnetPose(100, 100, false);
    const win = dockMagnetPose(100, 100, true);
    assert.ok(win.risePx > rest.risePx);
    assert.ok(win.risePx > DOCK_MAGNET_MAX_RISE * 0.9);
    assert.ok(Math.abs(win.leanDeg) < 0.2);
    const side = dockMagnetPose(160, 100, true);
    assert.ok(side.shiftX > 0);
    assert.ok(side.leanDeg > 0);

    const mid = lerpMagnetPose(DOCK_MAGNET_REST, win, 0.5);
    assert.ok(mid.risePx > 0 && mid.risePx < win.risePx);
    assert.equal(magnetPoseSettled(DOCK_MAGNET_REST), true);
    assert.equal(magnetPoseSettled(win), false);
    assert.match(dockMagnetTransform(win) ?? "", /translateY\(-/);

    let map = stepHoverMap({}, "logs", 0.05);
    assert.ok((map.logs ?? 0) > 0);
    assert.equal(map.tasks, undefined);
    map = stepHoverMap({ logs: 0.8 }, "tasks", 0.05);
    assert.ok((map.logs ?? 0) > 0 && (map.logs ?? 0) < 0.8);
    assert.ok((map.tasks ?? 0) > 0);
  });
});

