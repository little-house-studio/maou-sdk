import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { desktopApiPath, desktopWsPath } from "./desktop-transport.ts";

const here = dirname(fileURLToPath(import.meta.url));
const viteConfig = readFileSync(join(here, "../../vite.config.ts"), "utf8");
const pkg = readFileSync(join(here, "../../package.json"), "utf8");
const mainTsx = readFileSync(join(here, "main.tsx"), "utf8");

describe("desktop transport paths", () => {
  it("keeps /api paths and drops page assets", () => {
    assert.equal(desktopApiPath("/api/meta"), "/api/meta");
    assert.equal(desktopApiPath("/api/terminals?all=1"), "/api/terminals?all=1");
    assert.equal(desktopApiPath("http://127.0.0.1:5173/api/chat"), "/api/chat");
    assert.equal(desktopApiPath("/main.tsx"), null);
    assert.equal(desktopApiPath("/assets/index.js"), null);
  });

  it("keeps /ws paths", () => {
    assert.equal(desktopWsPath("ws://127.0.0.1:5173/ws/terminal"), "/ws/terminal");
    assert.equal(
      desktopWsPath("ws://x/ws/agent-terminal?id=1&agent=coding"),
      "/ws/agent-terminal?id=1&agent=coding",
    );
    assert.equal(desktopWsPath("ws://x/other"), null);
  });

  it("dev vite has no UA gate and no 8787 proxy; renderer guards itself", () => {
    assert.doesNotMatch(viteConfig, /Electron/);
    assert.doesNotMatch(viteConfig, /8787/);
    assert.match(viteConfig, /open:\s*false/);
    assert.match(viteConfig, /port:\s*5173/);
    assert.match(mainTsx, /if \(desktop\)[\s\S]*只提供桌面客户端/);
  });

  it("bridge and transport install before any /api fetch", () => {
    const bridge = mainTsx.indexOf("createTauriBridge()");
    const transport = mainTsx.indexOf("installDesktopTransport()");
    const plugins = mainTsx.indexOf("refreshThemeAndPlugins()");
    assert.ok(bridge > 0 && bridge < transport, "bridge before transport");
    assert.ok(transport < plugins, "transport before first /api fetch");
  });

  it("package scripts have no browser HTTP entry and no Electron", () => {
    assert.doesNotMatch(pkg, /dev:http/);
    assert.doesNotMatch(pkg, /dev:server/);
    assert.doesNotMatch(pkg, /start:http/);
    assert.doesNotMatch(pkg, /electron/i);
    assert.match(pkg, /"dev": "tauri dev"/);
  });
});
