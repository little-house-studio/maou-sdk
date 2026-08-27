import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { desktopApiPath, desktopWsPath } from "./desktop-transport.ts";

const here = dirname(fileURLToPath(import.meta.url));
const viteConfig = readFileSync(join(here, "../../vite.config.ts"), "utf8");
const pkg = readFileSync(join(here, "../../package.json"), "utf8");

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

  it("dev vite rejects browsers and has no 8787 proxy", () => {
    assert.match(viteConfig, /function electronOnly/);
    assert.match(viteConfig, /\/Electron\/i/);
    assert.match(viteConfig, /statusCode = 403/);
    assert.doesNotMatch(viteConfig, /8787/);
    assert.match(viteConfig, /open:\s*false/);
  });

  it("package scripts have no browser HTTP entry", () => {
    assert.doesNotMatch(pkg, /dev:http/);
    assert.doesNotMatch(pkg, /dev:server/);
    assert.doesNotMatch(pkg, /start:http/);
  });
});
