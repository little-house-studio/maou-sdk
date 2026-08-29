import { createRoot } from "react-dom/client";
import { App } from "./App";
import { paintDesktopChrome } from "./desktop-chrome";
import { installDesktopTransport } from "./desktop-transport";
import { paintThemeSnapshot, readThemeSnapshot } from "./theme";
import { refreshThemeAndPlugins, watchSystemTheme } from "./plugin-ui";
import "./fonts.css";
import "./styles.css";

paintDesktopChrome(document.documentElement, window.maouApp?.platform);
paintThemeSnapshot(
  readThemeSnapshot(typeof localStorage === "undefined" ? null : localStorage),
);
void refreshThemeAndPlugins();
watchSystemTheme();
const desktop = installDesktopTransport();
if (!desktop && navigator.userAgent.includes("Electron")) {
  console.error("[maou-app] window.maouApp missing — preload did not bind");
}

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<App />);
}
