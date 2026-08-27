/**
 * Bottom dock — continuous board geometry, slot lift, free float, stow, reorder.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BottomInfoBar, dockCardGeometry } from "./BottomInfoBar";
import {
  DOCK_CARDS,
  FOLDER_PATH_TAB,
  buildFolderPath,
  boardHeightForPanel,
  boardPlacementFromSlot,
  boardTiltDeg,
  boardTopFromSlotBottom,
  boardWidthForPanel,
  defaultDockOrder,
  dockCardWidth,
  dockTabZIndex,
  lerpBoardPos,
  reorderDockOrder,
  reorderIndexFromCenters,
  shouldStowFloat,
  stowProgressFromHeight,
  DOCK_PREVIEW_W_MIN,
  DOCK_EXPAND_H_UI,
  DOCK_EXPAND_W_UI,
  DOCK_TAB_H,
  DOCK_TAB_W,
  FOLDER,
  OPEN_KICK_V,
  SPRING_OPEN,
  springStep,
  springSettled,
} from "../bottom-dock";
import type { DraftMeta } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const META: DraftMeta = {
  projectPath: "~/x",
  projectLabel: "x",
  agentName: "coding",
  sandboxMode: "ask",
  provider: "openai",
  model: "gpt-5",
};

describe("BottomInfoBar dock tray", () => {
  it("idle: one card SVG per slot with label+count (no float)", () => {
    const html = renderToStaticMarkup(
      createElement(BottomInfoBar, {
        termLines: ["$ ls", "ok"],
        bgTasks: [
          { id: "t1", title: "scan", status: "running", agent: "coding" },
        ],
        meta: META,
        activeAgent: {
          id: "a1",
          name: "coding",
          role: "编码",
          status: "running",
          group: "project",
        },
        agentBusy: true,
        agents: [],
      }),
    );
    assert.match(html, /wire-bottom-dock/);
    assert.match(html, /wire-dock-track/);
    assert.match(html, /wire-dock-track-fill/);
    assert.match(html, /data-dock-order=/);
    // Split: logs | tasks | terminal | agent | proactive
    assert.deepEqual(
      DOCK_CARDS.map((c) => c.id),
      ["logs", "tasks", "terminal", "agent", "proactive"],
    );
    for (const c of DOCK_CARDS) {
      assert.match(html, new RegExp(`data-dock-card="${c.id}"`));
      assert.match(html, new RegExp(c.label));
    }
    assert.match(html, /M0 1V4H11\.5V1H10\.5L9\.5 0H1L0 1Z/);
    assert.match(html, /wire-dock-card-ear/);
    // Additive hover shell always in DOM (opacity 0 when idle)
    assert.match(html, /wire-dock-tab-extra/);
    assert.match(html, /wire-dock-tab-label/);
    assert.match(html, /wire-dock-tab-badge/);
    assert.doesNotMatch(html, /data-dock-float="true"/);
    const paths = html.match(/data-folder-path=/g) ?? [];
    assert.equal(paths.length, DOCK_CARDS.length);
  });

  it("task board binds bgTasks via dock-plugin canvas host", () => {
    const src = readFileSync(join(here, "BottomInfoBar.tsx"), "utf8");
    assert.match(src, /bgTasks/);
    assert.match(src, /data-dock-body/);
    assert.match(src, /DockCanvasFace|dock-plugin/);
    assert.match(src, /createDefaultDockRegistry/);
    // no top-chrome task host in dock component
    assert.doesNotMatch(src, /stream-banner|BackgroundTasks/);
  });

  it("continuous geometry: hover grows right edge; text after; ear fixed", () => {
    assert.equal(FOLDER_PATH_TAB, "M0 1V4H11.5V1H10.5L9.5 0H1L0 1Z");
    const tab = dockCardGeometry({ phase: "tab", hoverProgress: 0 });
    assert.equal(tab.cssW, DOCK_TAB_W);
    assert.equal(tab.cssH, DOCK_TAB_H);
    assert.equal(tab.textOpacity, 0);
    assert.equal(tab.viewBox, `0 0 ${FOLDER.tabRight} ${FOLDER.stripBottom}`);

    const earlyHover = dockCardGeometry({
      phase: "tab",
      title: "标题",
      preview: "预览行",
      hoverProgress: 0.12,
    });
    assert.equal(earlyHover.bottomY, FOLDER.stripBottom);
    assert.ok(earlyHover.cssW >= DOCK_TAB_W);
    assert.match(earlyHover.pathD, /H10\.5L9\.5 0H1L0 1Z$/);
    // text still mostly hidden at start of width grow
    assert.ok(earlyHover.textOpacity < 0.15);

    const midHover = dockCardGeometry({
      phase: "tab",
      title: "标题",
      preview: "预览行",
      hoverProgress: 0.45,
    });
    assert.ok(midHover.cssW > DOCK_TAB_W);
    assert.ok(midHover.textOpacity > earlyHover.textOpacity);

    const fullHover = dockCardGeometry({
      phase: "tab",
      title: "标题",
      preview: "预览行",
      hoverProgress: 1,
    });
    assert.ok(fullHover.cssW >= midHover.cssW);
    assert.ok(fullHover.textOpacity > 0.9);
    assert.match(fullHover.pathD, /H10\.5L9\.5 0H1L0 1Z$/);

    const mid = dockCardGeometry({ phase: "expand", panelH: 40 });
    assert.ok(mid.cssW > DOCK_TAB_W && mid.cssW <= DOCK_EXPAND_W_UI);
    assert.equal(mid.cssH, boardHeightForPanel(40));
    assert.equal(mid.cssW, boardWidthForPanel(40));
    assert.match(mid.pathD, /H10\.5L9\.5 0H1L0 1Z$/);

    const earlyExpand = dockCardGeometry({
      phase: "expand",
      panelH: 8,
      title: "标题",
      preview: "预览行",
      hoverProgress: 1,
    });
    assert.ok(
      earlyExpand.cssW > boardWidthForPanel(8),
      "live pull keeps hover strip width so it does not snap skinny",
    );

    const exp = dockCardGeometry({ phase: "expand", panelH: 240 });
    assert.equal(exp.cssW, DOCK_EXPAND_W_UI);
    assert.equal(exp.cssH, DOCK_TAB_H + 240);
    assert.match(exp.pathD, /H10\.5L9\.5 0H1L0 1Z$/);
  });

  it("board lift / stow / tilt / spring punch helpers", () => {
    // Bottom edge pinned to slot while height grows (folder board out of rack)
    assert.equal(boardTopFromSlotBottom(800, 200), 600);
    const place = boardPlacementFromSlot(
      { left: 100, bottom: 900 },
      276,
      300,
      1200,
      900,
    );
    assert.equal(place.left, 100);
    assert.equal(place.top, 600);

    const midW = boardWidthForPanel(80);
    assert.ok(midW > DOCK_TAB_W && midW < DOCK_EXPAND_W_UI);

    const a = { left: 10, top: 20 };
    const b = { left: 110, top: 120 };
    assert.deepEqual(lerpBoardPos(a, b, 0.5), { left: 60, top: 70 });
    assert.equal(stowProgressFromHeight(0, 200), 1);
    assert.ok(stowProgressFromHeight(200, 200) < 0.05);
    assert.ok(Math.abs(boardTiltDeg(100)) <= 5);

    assert.equal(shouldStowFloat(780, 800), true);
    assert.equal(shouldStowFloat(100, 800), false);
    assert.ok(dockTabZIndex(4, 5) > dockTabZIndex(0, 5));
    assert.equal(reorderDockOrder(defaultDockOrder(), "tasks", 0)[0], "tasks");
    assert.equal(reorderIndexFromCenters([100, 200, 300], 250), 2);

    // Punchy open spring settles near target with kick
    assert.ok(OPEN_KICK_V >= 600);
    let s = { x: 0, v: OPEN_KICK_V };
    for (let i = 0; i < 200; i++) {
      s = springStep(s, DOCK_EXPAND_H_UI, 16, SPRING_OPEN);
    }
    assert.ok(springSettled(s, DOCK_EXPAND_H_UI, 4, 40));
  });

  it("accepts faces map + layout-driven size/resize for dock boards", () => {
    const src = readFileSync(join(here, "BottomInfoBar.tsx"), "utf8");
    assert.match(src, /faces\?:/);
    assert.match(src, /DockFaceMap|faceMap/);
    assert.match(src, /openTabRequest/);
    assert.match(src, /DockBoardShell|wire-dock-board-shell|wire-dock-terminal-host/);
    assert.match(src, /readDockBoardSize|writeDockBoardSize|resolveDockBoardLayout/);
    assert.match(src, /beginBoardResize|wire-dock-resize/);
    assert.match(src, /layout\.resizable|layoutFor/);
  });

  it("ships board lift + hover morph + free-float wiring", () => {
    const src = readFileSync(join(here, "BottomInfoBar.tsx"), "utf8");
    assert.match(src, /wire-dock-card/);
    assert.match(src, /wire-dock-tab-extra/);
    assert.match(src, /wire-dock-tab-preview/);
    assert.match(src, /hoverProgress/);
    assert.match(src, /stepHoverMap/);
    assert.match(src, /dockMagnetWinner/);
    assert.match(src, /dockMagnetTransform/);
    assert.match(src, /beginEarPress/);
    assert.match(src, /position:\s*"fixed"/);
    assert.match(src, /placeBoardOnSlot/);
    assert.match(src, /shouldStowFloat/);
    assert.match(src, /is-lifting/);
    assert.match(src, /breakaway/);
    assert.match(src, /easeCloseProgress|STOW_EASE_S/);
    assert.match(src, /OPEN_KICK_V/);
    assert.match(src, /holdHover|liveSnapRef/);
    assert.match(src, /style\.transform = "none"/);
    assert.match(src, /is-slot-pull/);
    assert.match(src, /Stay in-flow until breakaway/);
    assert.match(src, /setPointerCapture/);
    assert.doesNotMatch(src, /SPRING_CLOSE/);
    // label+badge always; no branch that removes them on hover
    assert.match(src, /wire-dock-tab-label/);
    assert.doesNotMatch(src, /wire-dock-float/);
    assert.doesNotMatch(src, /is-float-src/);
  });

  it("tab / preview / expand widths follow design", () => {
    assert.ok(dockCardWidth("tab") < dockCardWidth("preview"));
    assert.notEqual(dockCardWidth("preview"), dockCardWidth("expand"));
    assert.ok(DOCK_PREVIEW_W_MIN > 0 && DOCK_EXPAND_W_UI > 0);
  });

  it("folder face cascade + tight stack + left-cast shadow, no hard track edge", () => {
    const css = readFileSync(join(here, "../draft.css"), "utf8");
    const shellTerm =
      /\.wire-shell\.draft-shell\s+\.wire-term-pre\s*\{[^}]*background:\s*var\(--n-code-bg\)/s;
    const folderTermWin =
      /\.wire-shell\.draft-shell\s+\.wire-dock-folder-content[^{]*\.wire-term-pre\s*,[\s\S]*?\{[^}]*background:\s*transparent\s*!important/s;
    assert.ok(shellTerm.test(css));
    assert.ok(folderTermWin.test(css));
    assert.ok(css.search(folderTermWin) > css.search(shellTerm));
    // no gap between tabs; right stacks over left with leftward shadow
    assert.match(css, /\.wire-dock-track\s*\{[^}]*gap:\s*0/s);
    assert.match(css, /margin:\s*0\s+0\s+0\s+-6px/);
    assert.match(css, /drop-shadow\(\s*-2\.5px/);
    // magnet peek: bottom-origin lift (JS transform) + slot-mouth shadow
    assert.match(css, /transform-origin:\s*50%\s+100%/);
    assert.match(css, /\.wire-dock-card\.is-peeking/);
    assert.match(css, /\.wire-dock-card\.is-slot-pull/);
    assert.match(css, /inset\s+0\s+3px\s+5px/);
    // track canvas transparent; fill rail uses body-band height (折角)
    assert.match(
      css,
      /\.wire-dock-track\s*\{[^}]*background:\s*transparent/s,
    );
    assert.match(
      css,
      /\.wire-dock-track-fill\s*\{[^}]*--dock-strip-body-h/s,
    );
    // label face clears ear lip (body band)
    assert.match(
      css,
      /\.wire-dock-card-ear\s*\{[^}]*--dock-ear-rise-h/s,
    );
    assert.match(css, /\.wire-dock-card\.is-lifting/);
    assert.match(css, /\.wire-dock-track\s*\{[^}]*border-top:\s*none/s);
    assert.match(css, /--n-mono/);
    assert.match(css, /\.wire-dock-tab-preview/);
    assert.match(css, /\.wire-dock-tab-extra/);
    assert.match(css, /\.wire-dock-slot-spacer/);
    assert.doesNotMatch(css, /\.wire-dock-float\s*\{/);
  });
});
