/**
 * Settings surface + mode-tab wiring (shipped components).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "./SettingsPanel";
import { WireTopbar } from "../layout/WireTopbar";
import {
  addApiPreset,
  defaultApiConfig,
  maskApiKey,
  updateApiPreset,
} from "../api-settings";
import type { DraftApiConfig, DraftMeta } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const META: DraftMeta = {
  projectPath: "~/x",
  projectLabel: "x",
  agentName: "coding",
  sandboxMode: "ask",
  provider: "openai",
  model: "gpt-5",
};

describe("SettingsPanel API 设置", () => {
  it("renders as page presentation with connection + window + capability fields", () => {
    const api = defaultApiConfig();
    let latest: DraftApiConfig = api;
    const html = renderToStaticMarkup(
      createElement(SettingsPanel, {
        api,
        onApiChange: (n) => {
          latest = n;
        },
        presentation: "page",
        onClose: () => {},
      }),
    );
    assert.match(html, /wire-settings-page/);
    assert.match(html, /data-settings-presentation="page"/);
    assert.match(html, /wire-settings-panel/);
    assert.doesNotMatch(html, /wire-settings-overlay/);
    assert.match(html, /API 设置/);
    assert.match(html, /data-paste-fill="true"/);
    assert.match(html, /粘贴识别/);
    assert.match(html, /data-paste-fill-input/);
    // connection
    assert.match(html, /api-preset-name/);
    assert.match(html, /api-preset-url/);
    assert.match(html, /api-preset-key/);
    assert.match(html, /api-preset-model/);
    assert.match(html, /api-preset-protocol/);
    // window (LLM maxContext / maxTokens)
    assert.match(html, /api-preset-max-context/);
    assert.match(html, /api-preset-max-tokens/);
    assert.match(html, /maxContext/);
    assert.match(html, /maxTokens/);
    // capabilities (guardrail names)
    assert.match(html, /api-preset-vision/);
    assert.match(html, /api-preset-reasoning/);
    assert.match(html, /api-preset-tools/);
    assert.match(html, /supportsVision/);
    assert.match(html, /supportsReasoning/);
    assert.match(html, /nativeToolCalling/);
    assert.match(html, /data-api-cap-summary/);
    assert.match(html, /openai|gpt-5/);
    const fullKey = api.presets[0]!.key;
    assert.ok(fullKey.length > 8);
    assert.doesNotMatch(
      html,
      new RegExp(fullKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(
      html,
      new RegExp(maskApiKey(fullKey).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.equal(latest.presets.length, api.presets.length);
  });

  it("edit reflection: updated name/model appear after patch helpers used by UI", () => {
    let api = defaultApiConfig();
    api = updateApiPreset(api, 0, { name: "edited-main", model: "gpt-test" });
    const html = renderToStaticMarkup(
      createElement(SettingsPanel, {
        api,
        onApiChange: () => {},
        presentation: "page",
      }),
    );
    assert.match(html, /edited-main/);
    assert.match(html, /gpt-test/);
  });

  it("add preset flow increases list and shows editor actions", () => {
    let api = defaultApiConfig();
    const before = api.presets.length;
    api = addApiPreset(api);
    assert.equal(api.presets.length, before + 1);
    const html = renderToStaticMarkup(
      createElement(SettingsPanel, {
        api,
        onApiChange: () => {},
        presentation: "page",
      }),
    );
    assert.match(html, /preset-\d+|新增/);
    assert.match(html, /设为默认/);
    assert.match(html, /删除|重置/);
  });
});

describe("WireTopbar settings mode tab", () => {
  it("ships 设置 as a mode tab next to 聊天/项目/Team", () => {
    const html = renderToStaticMarkup(
      createElement(WireTopbar, {
        mode: "chat",
        onModeChange: () => {},
        meta: META,
        usageLabel: "1k",
        showFiles: false,
        onToggleFiles: () => {},
      }),
    );
    assert.match(html, /wire-mode-tabs/);
    assert.match(html, />聊天</);
    assert.match(html, />项目</);
    assert.match(html, />Team</);
    assert.match(html, />设置</);
    assert.match(html, /data-led-strip="3x18"/);
    assert.match(html, /data-state="idle"/);
    // gear drawer removed — settings is a mode tab
    assert.doesNotMatch(html, /打开设置|aria-haspopup="dialog"/);
  });

  it("LED strip turns run when agentBusy", () => {
    const html = renderToStaticMarkup(
      createElement(WireTopbar, {
        mode: "chat",
        onModeChange: () => {},
        meta: META,
        usageLabel: "1k",
        showFiles: false,
        onToggleFiles: () => {},
        agentBusy: true,
      }),
    );
    assert.match(html, /data-state="run"/);
    assert.match(html, /aria-label="Agent 运行中"/);
  });

  it("marks 设置 tab selected when mode is settings", () => {
    const html = renderToStaticMarkup(
      createElement(WireTopbar, {
        mode: "settings",
        onModeChange: () => {},
        meta: META,
        usageLabel: "1k",
        showFiles: true,
        onToggleFiles: () => {},
      }),
    );
    assert.match(html, /aria-selected="true"[^>]*>[\s\S]*?设置/);
    // active class on settings tab
    assert.match(html, /class="active"/);
  });
});

describe("DraftShell settings mode path (shipped source)", () => {
  const shellSrc = readFileSync(join(here, "../DraftShell.tsx"), "utf8");
  const topbarSrc = readFileSync(join(here, "../layout/WireTopbar.tsx"), "utf8");

  it("DraftShell mounts SettingsPanel as mode mid content", () => {
    assert.match(shellSrc, /from\s+["']\.\/panels\/SettingsPanel["']/);
    assert.match(shellSrc, /from\s+["']\.\/api-settings["']/);
    assert.match(shellSrc, /apiConfig/);
    assert.match(shellSrc, /defaultApiConfig/);
    assert.match(shellSrc, /mode === ["']settings["']/);
    assert.match(shellSrc, /wire-mid is-settings|is-settings/);
    assert.match(shellSrc, /presentation=["']page["']/);
    assert.match(shellSrc, /initialSettingsOpen/);
  });

  it("topbar includes settings in MODES list", () => {
    assert.match(topbarSrc, /id:\s*["']settings["']/);
    assert.match(topbarSrc, /label:\s*["']设置["']/);
    assert.doesNotMatch(topbarSrc, /onOpenSettings/);
    assert.match(topbarSrc, /LedStrip/);
    assert.match(topbarSrc, /agentBusy/);
  });

  it("mode switch keeps chat/project/team paths", () => {
    assert.match(shellSrc, /mode === ["']project["']/);
    assert.match(shellSrc, /mode === ["']team["']/);
    assert.match(shellSrc, /wire-mid is-chat|is-chat/);
  });
});
