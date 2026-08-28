import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { appPlatform } from "./index.js";

const windowSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../window.ts"),
  "utf8",
);
const iconSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../icon.ts"),
  "utf8",
);
const iconPng = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../resources/icon.png"),
);

describe("app platforms", () => {
  it("darwin uses hiddenInset chrome and a unix socket", () => {
    const p = appPlatform("darwin");
    assert.equal(p.id, "darwin");
    assert.equal(p.window.titleBarStyle, "hiddenInset");
    assert.deepEqual(p.window.trafficLightPosition, { x: 16, y: 13 });
    const path = p.ipcPath("/tmp/maou-user", 42);
    assert.match(path, /app-42\.sock$/);
    assert.ok(!path.startsWith("\\\\"));
  });

  it("win32 uses a named pipe", () => {
    const p = appPlatform("win32");
    assert.equal(p.id, "win32");
    assert.equal(p.ipcPath("C:\\Users\\x", 7), "\\\\.\\pipe\\maou-app-7");
  });

  it("linux uses a unix socket and autohides the menu", () => {
    const p = appPlatform("linux");
    assert.equal(p.id, "linux");
    assert.equal(p.window.autoHideMenuBar, true);
    assert.match(p.ipcPath("/home/u/.config/maou", 9), /app-9\.sock$/);
  });

  it("desktop window paints paper before first frame", () => {
    assert.match(windowSrc, /backgroundColor:\s*"#ededed"/);
  });

  it("desktop window uses the Maou seal icon", () => {
    assert.match(windowSrc, /icon:\s*resolveAppIcon\(\)/);
    assert.match(iconSrc, /resources\/icon\.png/);
    assert.equal(iconPng.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), true);
  });
});
