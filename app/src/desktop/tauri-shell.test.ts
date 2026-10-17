import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { HUB_READY_LINE } from "./hub-ready.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tauriDir = join(appRoot, "src-tauri");
const read = (rel: string) => readFileSync(join(tauriDir, rel), "utf8");
const json = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

describe("tauri shell", () => {
  it("config serves dist/client in prod and the vite port in dev", () => {
    const conf = json("tauri.conf.json");
    assert.equal(conf.identifier, "studio.littlehouse.maou.app");
    assert.equal(conf.productName, "Maou");
    assert.equal(conf.version, "../package.json");
    assert.equal(conf.build.frontendDist, "../dist/client");
    assert.equal(conf.build.devUrl, "http://127.0.0.1:5173");
    assert.match(conf.build.beforeDevCommand, /build:hub/);
    // 窗口由 Rust 按平台建（红绿灯 / 注入脚本），配置里不留
    assert.deepEqual(conf.app.windows, []);
    // dev 不要求 hub 资源存在；打包配置才带
    assert.equal(conf.bundle.resources, undefined);
  });

  it("pack overlay stages the node hub as a resource", () => {
    const pack = json("tauri.pack.conf.json");
    assert.deepEqual(pack.bundle.resources, { "../.tauri-stage/hub": "hub" });
    assert.match(pack.build.beforeBuildCommand, /stage:hub/);
    const hubRs = read("src/hub.rs");
    assert.match(
      hubRs,
      /join\("hub"\)\s*\.join\("dist"\)\s*\.join\("desktop"\)\s*\.join\("hub-main\.js"\)/,
    );
  });

  it("main window may drag the overlay title bar", () => {
    const cap = json("capabilities/default.json");
    assert.deepEqual(cap.windows, ["main"]);
    assert.ok(cap.permissions.includes("core:window:allow-start-dragging"));
    assert.ok(cap.permissions.includes("core:window:allow-internal-toggle-maximize"));
  });

  it("hub ready line matches the node side", () => {
    assert.match(read("src/hub.rs"), new RegExp(`HUB_READY_LINE: &str = "${HUB_READY_LINE}"`));
    assert.match(read("src/hub.rs"), /MAOU_HUB_PARENT_STDIN/);
    const hubRun = readFileSync(join(appRoot, "src/desktop/hub-run.ts"), "utf8");
    assert.match(hubRun, /MAOU_HUB_PARENT_STDIN/);
  });

  it("proxy talks to the hub socket only — no TCP listener", () => {
    const proxy = read("src/proxy.rs");
    assert.doesNotMatch(proxy, /TcpListener|TcpStream/);
    assert.match(proxy, /UnixStream::connect/);
    assert.match(proxy, /named_pipe::ClientOptions/);
    assert.match(proxy, /"\/ws\/terminal", "\/ws\/agent-terminal"/);
  });

  it("window paints paper before first frame and insets the traffic lights", () => {
    const platform = read("src/platform.rs");
    assert.match(platform, /Color\(0xed, 0xed, 0xed, 0xff\)/);
    assert.match(platform, /TitleBarStyle::Overlay/);
    assert.match(platform, /LogicalPosition::new\(16\.0, 13\.0\)/);
    assert.match(platform, /__MAOU_DESKTOP__/);
  });

  it("bundle icons come from the Maou seal", () => {
    const iconPng = readFileSync(join(appRoot, "resources/icon.png"));
    assert.ok(iconPng.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    for (const rel of json("tauri.conf.json").bundle.icon as string[]) {
      assert.ok(existsSync(join(tauriDir, rel)), `missing ${rel}`);
    }
  });
});
