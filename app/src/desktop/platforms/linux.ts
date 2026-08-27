import { join } from "node:path";
import type { AppPlatform } from "./types.js";

export const linux: AppPlatform = {
  id: "linux",
  window: {
    frame: true,
    autoHideMenuBar: true,
  },
  ipcPath: (userData, pid) => join(userData, "run", `app-${pid}.sock`),
  accel: {
    settings: "Control+,",
    hide: "",
    quit: "Control+Q",
  },
};
