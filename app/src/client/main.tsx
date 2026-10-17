import { createRoot } from "react-dom/client";
import { App } from "./App";
import { paintDesktopChrome } from "./desktop-chrome";
import { installDesktopTransport } from "./desktop-transport";
import { startPerfClient } from "./perf-client";
import { paintThemeSnapshot, readThemeSnapshot } from "./theme";
import { refreshThemeAndPlugins, watchSystemTheme } from "./plugin-ui";
import { createTauriBridge, isTauriShell } from "./tauri-bridge";
import { bindBootFlush } from "./boot-cache";
import "./fonts.css";
import "./styles.css";

// 桥和传输先装：后面的 /api 请求（插件主题、perf）都要走 hub
if (!window.maouApp && isTauriShell()) window.maouApp = createTauriBridge();
const desktop = installDesktopTransport();
// 开机快照：页面隐藏 / 关闭前把排队的写掉
bindBootFlush();

startPerfClient();

paintDesktopChrome(document.documentElement, window.maouApp?.platform);
paintThemeSnapshot(
  readThemeSnapshot(typeof localStorage === "undefined" ? null : localStorage),
);
void refreshThemeAndPlugins();
watchSystemTheme();

const el = document.getElementById("root");
if (el) {
  if (desktop) {
    createRoot(el).render(<App />);
  } else {
    el.textContent =
      "Maou 只提供桌面客户端，请运行 pnpm --filter @little-house-studio/app dev";
  }
}
