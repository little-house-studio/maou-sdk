/**
 * Standalone draft site entry — only DraftShell, no live App / API chrome.
 * Dev: Electron window (Vite, Electron UA only)
 * Build: dist/client/draft.html
 */
import { createRoot } from "react-dom/client";
import { paintDesktopChrome } from "./desktop-chrome";
import { paintSheetTheme, readSheetTheme } from "./theme";
import { DraftShell } from "./drafts";
import "./fonts.css";
import "./styles.css";

paintDesktopChrome(document.documentElement, window.maouApp?.platform);
paintSheetTheme(
  document.documentElement,
  readSheetTheme(typeof localStorage === "undefined" ? null : localStorage),
);

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<DraftShell />);
}
