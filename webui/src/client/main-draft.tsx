/**
 * Standalone draft site entry — only DraftShell, no live App / API chrome.
 * Dev:  http://127.0.0.1:5173/draft.html
 * Build: dist/client/draft.html
 */
import { createRoot } from "react-dom/client";
import { DraftShell } from "./drafts";
import "./fonts.css";
import "./styles.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<DraftShell />);
}
