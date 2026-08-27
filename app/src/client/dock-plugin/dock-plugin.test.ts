/**
 * dock-plugin: registration + canvas-ui paint + polyfill soft-load.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultDockRegistry,
  createEmptyDockRegistry,
  registerDockPlugin,
  listDockPlugins,
  getDockPlugin,
  dockPluginIds,
  resolveDockBoardLayout,
  DEFAULT_DOCK_CONTENT_KIND,
  DEFAULT_DOCK_BOARD_LAYOUT,
  clampDockBoardSize,
  defaultDockBoardSize,
  paintDockCanvasUiFace,
  linesForDockCard,
  loadHtmlInCanvasPolyfill,
  resetHtmlInCanvasPolyfillCache,
  tryDrawHtmlElementToCanvas,
} from "./index";
import { DOCK_CARDS, buildFolderPath, FOLDER_PATH_TAB } from "../drafts/bottom-dock";

describe("dock-plugin registry", () => {
  it("default registry covers all DOCK_CARDS with content kinds + layouts", () => {
    const reg = createDefaultDockRegistry();
    const ids = dockPluginIds(reg);
    assert.equal(ids.length, DOCK_CARDS.length);
    for (const c of DOCK_CARDS) {
      const slot = getDockPlugin(reg, c.id);
      assert.ok(slot);
      assert.equal(slot!.label, c.label);
      assert.equal(slot!.contentKind, DEFAULT_DOCK_CONTENT_KIND[c.id]);
      assert.ok(slot!.layout);
      assert.equal(
        slot!.layout!.defaultWidth,
        DEFAULT_DOCK_BOARD_LAYOUT[c.id].defaultWidth,
      );
      assert.ok(slot!.layout!.defaultHeight > 0);
    }
    // at least one canvas-ui and one react slot
    const kinds = listDockPlugins(reg).map((s) => s.contentKind);
    assert.ok(kinds.includes("canvas-ui"));
    assert.ok(kinds.includes("react"));
  });

  it("resolveDockBoardLayout falls back to defaults", () => {
    const layout = resolveDockBoardLayout(null, "proactive");
    assert.equal(layout.defaultWidth, 680);
    assert.equal(layout.surface, "paper");
    assert.equal(layout.resizable, true);
  });

  it("clampDockBoardSize respects min/max", () => {
    const layout = DEFAULT_DOCK_BOARD_LAYOUT.terminal;
    const c = clampDockBoardSize({ w: 10, h: 10 }, layout);
    assert.ok(c.w >= (layout.minWidth ?? 0));
    assert.ok(c.h >= (layout.minHeight ?? 0));
    const d = defaultDockBoardSize(layout);
    assert.equal(d.w, clampDockBoardSize(d, layout).w);
  });

  it("registerDockPlugin replaces by id immutably", () => {
    const base = createEmptyDockRegistry();
    const a = registerDockPlugin(base, {
      id: "logs",
      label: "日志",
      tone: "logs",
      contentKind: "canvas-ui",
    });
    assert.equal(base.slots.length, 0);
    assert.equal(a.slots.length, 1);
    const b = registerDockPlugin(a, {
      id: "logs",
      label: "LOGS",
      tone: "logs",
      contentKind: "html-canvas",
    });
    assert.equal(b.slots.length, 1);
    assert.equal(getDockPlugin(b, "logs")!.contentKind, "html-canvas");
    assert.equal(getDockPlugin(a, "logs")!.contentKind, "canvas-ui");
  });
});

describe("dock-plugin canvas-ui host", () => {
  it("linesForDockCard picks bags by id", () => {
    assert.deepEqual(
      linesForDockCard("logs", { logs: ["a", "b"] }),
      ["a", "b"],
    );
    assert.deepEqual(linesForDockCard("terminal", { termLines: ["$ ls"] }), [
      "$ ls",
    ]);
    assert.ok(linesForDockCard("tasks", {}).length >= 1);
  });

  it("paintDockCanvasUiFace draws without throw on mock 2d", () => {
    const ops: string[] = [];
    const ctx = {
      setTransform: () => ops.push("setTransform"),
      clearRect: () => ops.push("clearRect"),
      fillRect: () => ops.push("fillRect"),
      fillStyle: "",
      font: "",
      fillText: () => ops.push("fillText"),
      strokeRect: () => ops.push("strokeRect"),
      strokeStyle: "",
      lineWidth: 1,
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      save: () => {},
      restore: () => {},
    } as unknown as CanvasRenderingContext2D;

    paintDockCanvasUiFace(ctx, 200, 120, {
      id: "logs",
      title: "logs board",
      lines: ["line one", "line two"],
      count: 2,
      accent: "#ff5a2e",
    });
    assert.ok(ops.includes("setTransform"));
    assert.ok(ops.includes("clearRect"));
    assert.ok(ops.includes("fillRect"));
  });

  it("folder path topology still independent of plugin paint", () => {
    assert.equal(FOLDER_PATH_TAB, "M0 1V4H11.5V1H10.5L9.5 0H1L0 1Z");
    assert.match(buildFolderPath(40, 4), /H10\.5L9\.5 0H1L0 1Z$/);
  });
});

describe("dock-plugin html-in-canvas soft load", () => {
  it("loadHtmlInCanvasPolyfill degrades without window (SSR)", async () => {
    resetHtmlInCanvasPolyfillCache();
    // node test env: no real polyfill install required
    const r = await loadHtmlInCanvasPolyfill(true);
    // In node, dynamic import may succeed or fail — either way must not throw
    assert.ok(r.ok === true || r.ok === false);
    if (!r.ok) assert.ok(typeof r.error === "string");
  });

  it("tryDrawHtmlElementToCanvas returns false without drawElementImage", () => {
    // jsdom-less: fabricate canvas-like object
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: () => {},
        drawElementImage: undefined,
      }),
      appendChild: () => {},
    } as unknown as HTMLCanvasElement;
    const el = { parentElement: null } as unknown as HTMLElement;
    assert.equal(tryDrawHtmlElementToCanvas(canvas, el, 100, 80), false);
  });
});
