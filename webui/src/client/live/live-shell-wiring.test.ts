/**
 * Structural proof that production App mounts draft-aligned live shell
 * and keeps Chat/Terminal/Markdown + client API entry points.
 * Runs against shipped source (not a re-implementation).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");

function read(rel: string): string {
  return readFileSync(join(clientRoot, rel), "utf8");
}

describe("live shell production wiring", () => {
  const app = read("App.tsx");
  const chat = read("ChatPanel.tsx");
  const term = read("TerminalPanel.tsx");
  const api = read("api.ts");
  const mdApi = read("markdown/api.ts");
  const main = read("main.tsx");
  const adapters = read("live/adapters.ts");

  it("production entry mounts App (not DraftShell alone)", () => {
    assert.match(main, /from\s+["']\.\/App["']/);
    assert.match(main, /<App\s*\/>/);
  });

  it("App is draft-aligned wire shell with live modes", () => {
    assert.match(app, /data-live-shell/);
    assert.match(app, /WireTopbar/);
    assert.match(app, /BottomInfoBar/);
    assert.match(app, /UiMode/);
    // Mode surfaces
    for (const m of ["chat", "project", "team", "settings"] as const) {
      assert.match(app, new RegExp(`["']${m}["']|mode === ["']${m}["']`));
    }
    assert.match(app, /LiveSettingsPanel|LiveProjectHost|TeamBoard/);
    assert.match(app, /TeamBoard/);
  });

  it("production settings use live meta/models not draft showcase seeds", () => {
    // Must not seed defaultApiConfig as production settings SoT
    assert.doesNotMatch(app, /defaultApiConfig\s*\(/);
    // Draft SettingsPanel component must not be the production settings mount
    assert.doesNotMatch(app, /from\s+["']\.\/drafts["'][^;]*SettingsPanel|,\s*SettingsPanel\s*,/);
    assert.doesNotMatch(app, /<\s*SettingsPanel\b/);
    assert.match(app, /LiveSettingsPanel/);
    assert.match(app, /onSettingsMetaChange/);
    const liveSettings = read("live/LiveSettingsPanel.tsx");
    assert.match(liveSettings, /fetchMeta/);
    assert.match(liveSettings, /fetchModels/);
    assert.match(liveSettings, /setModel/);
    assert.match(liveSettings, /data-live-settings/);
    assert.doesNotMatch(liveSettings, /sk-draft-openai/);
    assert.doesNotMatch(liveSettings, /defaultApiConfig/);
    // Stable parent callback + mount-only load (no /api/meta loop)
    assert.match(liveSettings, /onMetaChangeRef/);
    assert.match(liveSettings, /lastPushedRef/);
    assert.match(liveSettings, /mount-only|deps \[\]|intentional mount/);
    const adapters = read("live/settings-adapters.ts");
    assert.match(adapters, /buildLiveSettingsSnapshot/);
    assert.match(adapters, /isDraftShowcaseApiKey/);
  });

  it("App wires live ChatPanel + session portal + terminal + files", () => {
    assert.match(app, /ChatPanel/);
    assert.match(app, /threadRailId/);
    assert.match(app, /live-session-rail|LIVE_SESSION_RAIL/);
    assert.match(app, /className=["']wire-context["']|className=\{\s*["']wire-context["']/);
    assert.match(app, /chrome=["']wire["']/);
    assert.match(app, /TerminalPanel/);
    assert.match(app, /onOpenTerminal/);
    assert.match(app, /showFiles|onToggleFiles/);
    assert.match(app, /fetchMeta|onMetaChange/);
    assert.match(app, /fetchTerminals/);
    assert.match(app, /onTabChange|onDockTabChange/);
    assert.match(app, /is-hidden-mode|hidden=\{!chatVisible\}/);
  });

  it("App agent rail uses liveAgentsToDraftAgents + fetchAgents not meta-only SoT", () => {
    assert.match(app, /fetchAgents/);
    assert.match(app, /liveAgentsToDraftAgents/);
    assert.match(app, /setActiveAgent/);
    assert.match(app, /onSelectAgent|liveAgentRows|activeSwitchId/);
    // Still may fall back to metaToAgents when list empty
    assert.match(app, /metaToAgents/);
    // No bare name-only highlight when switch_id misses (multi-project safe)
    assert.match(app, /activeProjectPath/);
    assert.doesNotMatch(
      app,
      /agents\.find\(\(a\) => a\.name === activeAgentName\) \?\? agents\[0\]/,
    );
    // Do not hardcode activeId to agents[0] (wrong multi-project coding row)
    assert.doesNotMatch(app, /activeId=\{activeAgent\?\.id \?\? agents\[0\]/);
    // Initial switch id must not assume system:coding (list may only have system:main)
    assert.doesNotMatch(
      app,
      /useState<string>\(\s*["']system:coding["']\s*\)/,
    );
    const api = read("api.ts");
    assert.match(api, /\/api\/agents/);
    assert.match(api, /\/api\/agents\/active/);
    assert.match(api, /switchId/);
    const serverList = read("../server/agent-list.ts");
    assert.match(serverList, /listOpsAgentsForWeb/);
    assert.match(serverList, /projects\.json|getProjectsList/);
    assert.match(serverList, /parseAgentSwitchId/);
    assert.match(serverList, /resolveDefaultSwitchId/);
    assert.match(serverList, /ensureProjectPaths/);
    const hub = read("../server/agent-hub.ts");
    assert.match(hub, /resolveDefaultSwitchId/);
    // Constructor defaults via resolveDefaultSwitchId (project path when applicable)
    assert.match(
      hub,
      /const def = resolveDefaultSwitchId\([\s\S]*?this\._activeSwitchId = def\.switchId/,
    );
    assert.match(hub, /_activeProjectPath = def\.projectPath/);
  });

  it("ChatPanel wire chrome: Chinese rail + IME + wire composer classes", () => {
    assert.match(chat, /chrome\?:\s*["']default["']\s*\|\s*["']wire["']/);
    assert.match(chat, /新建会话/);
    assert.match(chat, /isComposing/);
    assert.match(chat, /wire-composer-dock/);
    assert.match(chat, /wire-session-list/);
    // Draft ContextPanel parity: float bottom + no top stream banner in wire
    assert.match(chat, /wire-float-bottom/);
    assert.match(chat, /ApprovalBanner/);
    assert.match(chat, /wire-jump-bottom/);
    assert.match(chat, /wire-jump-prev/);
    assert.match(chat, /busy && !isWire/);
    assert.match(chat, /WireThreadView|groupThreadBlocks|chatLinesToDraftMessages/);
    assert.match(chat, /onDockLogLines/);
    assert.match(chat, /composer-tool-btn/);
    assert.match(chat, /ChromeMark/);
    assert.match(chat, /wire-composer-card/);
  });

  it("App merges chat dock logs into BottomInfoBar", () => {
    assert.match(app, /onDockLogLines/);
    assert.match(app, /chatLogLines/);
    assert.match(app, /termLinesRaw|termLines/);
  });

  it("App chat files rail uses LiveFilesRail (draft FilesRail + live FS)", () => {
    assert.match(app, /LiveFilesRail/);
    const liveFiles = read("live/LiveFilesRail.tsx");
    assert.match(liveFiles, /FilesRail/);
    assert.match(liveFiles, /fetchMdTree/);
    assert.match(liveFiles, /MarkdownWorkbench/);
  });

  it("App project mode uses LiveProjectHost (ProjectWorkbench + live FS)", () => {
    assert.match(app, /LiveProjectHost/);
    const liveProj = read("live/LiveProjectHost.tsx");
    assert.match(liveProj, /ProjectWorkbench/);
    assert.match(liveProj, /fetchMdTree|readFsFile/);
    assert.match(liveProj, /writeFsFile|onPersistMarkdown/);
  });

  it("ChatPanel usage uses fetchSessionStats", () => {
    assert.match(chat, /fetchSessionStats/);
  });

  it("ContextPanel message tree shares WireThreadView with live", () => {
    const ctx = read("drafts/panels/ContextPanel.tsx");
    assert.match(ctx, /WireThreadView/);
    assert.doesNotMatch(ctx, /function MessageRow/);
  });

  it("live adapters map Meta and terminals for dock/topbar", () => {
    assert.match(adapters, /metaToDraftMeta/);
    assert.match(adapters, /terminalsToTermLines/);
    assert.match(adapters, /terminalsToBgTasks/);
    assert.match(app, /metaToDraftMeta/);
    assert.match(app, /terminalsToTermLines/);
  });

  it("ChatPanel keeps stream/abort/sessions/approval/model/export", () => {
    assert.match(chat, /streamChat/);
    assert.match(chat, /abortChat/);
    assert.match(chat, /createSession/);
    assert.match(chat, /switchSession/);
    assert.match(chat, /answerApproval/);
    assert.match(chat, /setApprovalMode|setModel/);
    assert.match(chat, /exportTranscript|handleSlash|\/export/);
    assert.match(chat, /className/);
  });

  it("TerminalPanel + api keep WS and list/stop", () => {
    assert.match(term, /agentTerminalWsUrl/);
    assert.match(term, /fetchTerminals/);
    assert.match(api, /\/api\/chat/);
    assert.match(api, /\/api\/chat\/abort/);
    assert.match(api, /\/api\/terminals/);
    assert.match(api, /\/ws\/agent-terminal/);
    assert.match(mdApi, /\/api\/fs\/md-tree/);
    assert.match(mdApi, /\/api\/fs\/file/);
  });

  it("hotkeys Ctrl+B / Ctrl+` / Ctrl+Shift+F remain on App", () => {
    assert.match(app, /e\.key === ["']`["']/);
    assert.match(app, /toLowerCase\(\) === ["']b["']/);
    assert.match(app, /toLowerCase\(\) === ["']f["']/);
  });
});
