import type { AppPlatform } from "./types.js";

export const win32: AppPlatform = {
  id: "win32",
  window: {
    frame: true,
    autoHideMenuBar: true,
  },
  ipcPath: (_userData, pid) => `\\\\.\\pipe\\maou-app-${pid}`,
  accel: {
    settings: "Control+,",
    hide: "",
    quit: "Alt+F4",
  },
};
