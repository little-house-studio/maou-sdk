/**
 * webui dock-plugin — bottom folder boards as free canvas / react plug-in slots.
 *
 * How to add a designable board face:
 * 1. Ensure DOCK_CARDS has the id + tone
 * 2. Set DEFAULT_DOCK_BOARD_LAYOUT[id] (size, resizable, surface)
 * 3. Set DEFAULT_DOCK_CONTENT_KIND[id] = "react" (or canvas)
 * 4. Pass faces={{ [id]: <YourHost /> }} into BottomInfoBar / DraftShell
 * 5. Optionally wrap with DockBoardShell surface tokens / layout helper classes
 */
export type {
  DockContentKind,
  DockPluginSlot,
  DockPluginRegistry,
  DockCanvasPaintInput,
  DockFaceMap,
  DockBoardLayout,
  DockBoardSurface,
} from "./types";

export {
  createEmptyDockRegistry,
  createDefaultDockRegistry,
  registerDockPlugin,
  listDockPlugins,
  getDockPlugin,
  dockPluginIds,
  resolveDockBoardLayout,
  DEFAULT_DOCK_CONTENT_KIND,
} from "./registry";

export {
  DEFAULT_DOCK_BOARD_LAYOUT,
  getDefaultDockBoardLayout,
  dockViewportSizeLimits,
  clampDockBoardSize,
  defaultDockBoardSize,
  readDockBoardSize,
  writeDockBoardSize,
  type DockBoardSize,
} from "./layout";

export {
  paintDockCanvasUiFace,
  sizeCanvasToCss,
  linesForDockCard,
} from "./canvas-host";

export {
  loadHtmlInCanvasPolyfill,
  resetHtmlInCanvasPolyfillCache,
  tryDrawHtmlElementToCanvas,
  type PolyfillLoadResult,
  type Ctx2dWithHtml,
} from "./html-canvas";

export { DockCanvasFace, type DockCanvasFaceProps } from "./DockCanvasFace";
export { DockBoardShell, type DockBoardShellProps } from "./DockBoardShell";
