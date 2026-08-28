import { BrowserWindow } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAppIcon } from "./icon.js";
import type { AppPlatform } from "./platforms/types.js";

export function createAppWindow(opts: {
  platform: AppPlatform;
  preload: string;
  rendererUrl?: string;
  rendererFile?: string;
}): BrowserWindow {
  const chrome = opts.platform.window;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: "#ededed",
    icon: resolveAppIcon(),
    show: false,
    frame: chrome.frame,
    autoHideMenuBar: chrome.autoHideMenuBar,
    titleBarStyle: chrome.titleBarStyle,
    trafficLightPosition: chrome.trafficLightPosition,
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  if (opts.rendererUrl) {
    void win.loadURL(opts.rendererUrl);
  } else if (opts.rendererFile) {
    void win.loadFile(opts.rendererFile);
  } else {
    void win.loadURL(pathToFileURL(join(process.cwd(), "dist/client/index.html")).href);
  }
  return win;
}
