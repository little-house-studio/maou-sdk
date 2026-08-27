import { join } from "node:path";
import type { AppPlatform } from "./types.js";

export const darwin: AppPlatform = {
  id: "darwin",
  window: {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 13 },
    frame: true,
    autoHideMenuBar: false,
  },
  ipcPath: (userData, pid) => join(userData, "run", `app-${pid}.sock`),
  accel: {
    settings: "Command+,",
    hide: "Command+H",
    quit: "Command+Q",
  },
};
