/**
 * PluginsPanel：顶栏插件页（开关 / 重载 / 状态）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginsPanel } from "./PluginsPanel";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "PluginsPanel.tsx"), "utf8");

describe("PluginsPanel", () => {
  it("renders title, reload, and empty copy", () => {
    const html = renderToStaticMarkup(createElement(PluginsPanel, { plugins: [] }));
    assert.match(html, /wire-plugins/);
    assert.match(html, /wire-plugins-reload/);
    assert.match(html, /wire-plugins-empty/);
    assert.doesNotMatch(html, /TeamBoard|wire-team/);
  });

  it("lists a plugin row with phase and toggle", () => {
    const html = renderToStaticMarkup(
      createElement(PluginsPanel, {
        plugins: [
          {
            id: "demo",
            name: "Demo",
            phase: "ready",
            enabled: true,
            version: "1.0.0",
            ui: true,
          },
        ],
      }),
    );
    assert.match(html, /wire-plugin-row is-ready is-on/);
    assert.match(html, /Demo/);
    assert.match(html, /1\.0\.0/);
    assert.match(html, /demo/);
    assert.match(html, /type="checkbox"/);
  });

  it("talks to disk plugin APIs", () => {
    assert.match(src, /\/api\/plugins/);
    assert.match(src, /\/api\/plugins\/reload/);
    assert.match(src, /\/api\/plugins\/toggle/);
    assert.match(src, /refreshThemeAndPlugins/);
  });
});
