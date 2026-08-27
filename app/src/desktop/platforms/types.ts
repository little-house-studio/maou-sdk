export type AppPlatformId = "darwin" | "win32" | "linux";

export type AppWindowChrome = {
  titleBarStyle?: "hiddenInset" | "default";
  trafficLightPosition?: { x: number; y: number };
  frame: boolean;
  autoHideMenuBar: boolean;
};

export type AppAccelerators = {
  settings: string;
  hide: string;
  quit: string;
};

export type AppPlatform = {
  id: AppPlatformId;
  window: AppWindowChrome;
  ipcPath: (userData: string, pid: number) => string;
  accel: AppAccelerators;
};
