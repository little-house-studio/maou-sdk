import { createRoot } from "react-dom/client";
import { App } from "./App";
import { paintDesktopChrome } from "./desktop-chrome";
import { installDesktopTransport } from "./desktop-transport";
import { paintSheetTheme, readSheetTheme } from "./theme";
import "./fonts.css";
import "./styles.css";

paintDesktopChrome(document.documentElement, window.maouApp?.platform);
paintSheetTheme(
  document.documentElement,
  readSheetTheme(typeof localStorage === "undefined" ? null : localStorage),
);
const desktop = installDesktopTransport();
if (!desktop && navigator.userAgent.includes("Electron")) {
  console.error("[maou-app] window.maouApp missing — preload did not bind");
}

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<App />);
}
