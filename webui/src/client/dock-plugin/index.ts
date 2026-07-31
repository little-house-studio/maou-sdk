/**
 * webui dock-plugin — bottom folder boards as free canvas plug-in slots.
 */
export type {
  DockContentKind,
  DockPluginSlot,
  DockPluginRegistry,
  DockCanvasPaintInput,
} from "./types";

export {
  createEmptyDockRegistry,
  createDefaultDockRegistry,
  registerDockPlugin,
  listDockPlugins,
  getDockPlugin,
  dockPluginIds,
  DEFAULT_DOCK_CONTENT_KIND,
} from "./registry";

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
