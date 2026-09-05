import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { paintDesktopChrome, resolveAppChrome } from "./desktop-chrome.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("desktop chrome", () => {
  it("prefers preload platform over UA", () => {
    assert.equal(resolveAppChrome("darwin", "Windows NT Electron/1"), "darwin");
    assert.equal(resolveAppChrome("win32", "Macintosh Electron/1"), "win32");
  });

  it("reads Electron UA when preload is missing", () => {
    assert.equal(
      resolveAppChrome(undefined, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/38.0.0"),
      "darwin",
    );
    assert.equal(resolveAppChrome(undefined, "Mozilla/5.0 (Macintosh) Chrome/120"), "");
  });

  it("paints data-app-chrome on the root", () => {
    const root = { dataset: {} as { appChrome?: string } };
    paintDesktopChrome(root, "darwin", "");
    assert.equal(root.dataset.appChrome, "darwin");
  });

  it("darwin topbar is a drag strip with traffic-light inset", () => {
    const css = readFileSync(join(here, "wire/wire.css"), "utf8");
    assert.match(css, /\[data-app-chrome="darwin"\][\s\S]*-webkit-app-region:\s*drag/);
    assert.match(css, /\[data-app-chrome="darwin"\][\s\S]*padding-left:\s*80px/);
    assert.match(css, /\[data-app-chrome="darwin"\][\s\S]*-webkit-app-region:\s*no-drag/);
  });
});
