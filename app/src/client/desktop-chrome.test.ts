import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { paintDesktopChrome, resolveAppChrome } from "./desktop-chrome.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("desktop chrome", () => {
  it("accepts only the shell-injected platform ids", () => {
    assert.equal(resolveAppChrome("darwin"), "darwin");
    assert.equal(resolveAppChrome("win32"), "win32");
    assert.equal(resolveAppChrome("linux"), "linux");
    assert.equal(resolveAppChrome(undefined), "");
    assert.equal(resolveAppChrome("freebsd"), "");
  });

  it("paints data-app-chrome on the root", () => {
    const root = { dataset: {} as { appChrome?: string } };
    paintDesktopChrome(root, "darwin");
    assert.equal(root.dataset.appChrome, "darwin");
    const bare = { dataset: {} as { appChrome?: string } };
    paintDesktopChrome(bare, undefined);
    assert.equal(bare.dataset.appChrome, undefined);
  });

  it("index.html paints chrome from the Tauri init script, not the UA", () => {
    const html = readFileSync(join(here, "index.html"), "utf8");
    assert.match(html, /__MAOU_DESKTOP__/);
    assert.doesNotMatch(html, /userAgent/);
    assert.doesNotMatch(html, /Electron/);
  });

  it("darwin topbar keeps the traffic-light inset and drags via Tauri", () => {
    const css = readFileSync(join(here, "wire/wire.css"), "utf8");
    assert.match(css, /\[data-app-chrome="darwin"\][\s\S]*padding-left:\s*80px/);
    assert.doesNotMatch(css, /app-region/);
    const topbar = readFileSync(join(here, "wire/chrome/WireTopbar.tsx"), "utf8");
    assert.match(topbar, /data-tauri-drag-region=\{darwinChrome \? "deep" : undefined\}/);
    assert.match(topbar, /role="tablist"[\s\S]*data-tauri-drag-region=\{darwinChrome \? "false"/);
    assert.doesNotMatch(topbar, /userAgent/);
  });
});
