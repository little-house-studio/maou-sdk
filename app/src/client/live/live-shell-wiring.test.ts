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

function readGraph(rels: string[]): string {
  return rels.map(read).join("\n");
}

describe("live shell production wiring", () => {
  const appEntry = read("App.tsx");
  const app = readGraph([
    "App.tsx",
    "host/LiveApp.tsx",
    "host/live-state.tsx",
    "host/live-slots.tsx",
    "shell/WireShell.tsx",
    "shell/LiveMid.tsx",
    "shell/LeftAside.tsx",
    "shell/RightAside.tsx",
    "shell/ActivityBar.tsx",
    "shell/activity.ts",
    "shell/focus.ts",
    "shell/AsidePane.tsx",
    "shell/SidebarFrame.tsx",
    "ports/live.ts",
  ]);
  const chat = readGraph([
    "ChatPanel.tsx",
    "conversation/ConversationPane.tsx",
    "conversation/ThreadBoard.tsx",
    "conversation/UserStick.tsx",
    "conversation/contract.ts",
    "composer/Composer.tsx",
    "composer/ComposerBar.tsx",
    "composer/ComposerTools.tsx",
    "composer/QueueDock.tsx",
  ]);
  const term = read("TerminalPanel.tsx");
  const api = read("api.ts");
  const mdApi = read("markdown/api.ts");
  const main = read("main.tsx");
  const adapters = read("live/adapters.ts");

  it("production entry mounts App (not DraftShell alone)", () => {
    assert.match(main, /from\s+["']\.\/App["']/);
    assert.match(main, /<App\s*\/>/);
    assert.match(main, /paintDesktopChrome/);
    assert.match(main, /paintSheetTheme/);
  });

  it("App is draft-aligned wire shell with live modes", () => {
    const liveCss = read("live-shell.css");
    assert.match(
      liveCss,
      /\.live-shell \.wire-body\s*\{[^}]*flex-direction:\s*row/s,
    );
    assert.doesNotMatch(
      liveCss,
      /\.live-shell \.wire-body\s*\{[^}]*flex-direction:\s*column/s,
    );
    assert.match(app, /data-live-shell/);
    assert.match(app, /--shell-left/);
    assert.match(app, /--shell-files/);
    assert.match(app, /WireTopbar/);
    assert.match(app, /agentBusy=\{agentBusy\}|agentBusy,/);
    assert.match(app, /BottomInfoBar/);
    assert.match(app, /UiMode/);
    // Mode surfaces（主动已迁到底栏卡片，不在顶栏 mode）
    for (const m of ["chat", "project", "team", "settings"] as const) {
      assert.match(app, new RegExp(`["']${m}["']|mode === ["']${m}["']`));
    }
    assert.doesNotMatch(app, /mode === ["']proactive["']/);
    assert.match(app, /LiveSettingsPanel|LiveProjectHost|TeamBoard|ProactiveHost/);
    assert.match(app, /TeamBoard/);
    assert.match(app, /ProactiveHost/);
    assert.match(app, /dockFaces|faces=\{dockFaces\}|faces=\{\{/);
    assert.match(app, /presentation=["']card["']/);
  });

  it("production settings use live meta/models not draft showcase seeds", () => {
    // Must not seed defaultApiConfig as production settings SoT
    assert.doesNotMatch(app, /defaultApiConfig\s*\(/);
    // Draft SettingsPanel component must not be the production settings mount
    assert.doesNotMatch(appEntry, /from\s+["']\.\/drafts["'][^;]*SettingsPanel|,\s*SettingsPanel\s*,/);
    assert.doesNotMatch(app, /<\s*SettingsPanel\b/);
    assert.match(app, /LiveSettingsPanel/);
    assert.match(app, /onSettingsMetaChange/);
    const liveSettings = read("live/LiveSettingsPanel.tsx");
    assert.match(liveSettings, /fetchMeta/);
    assert.match(liveSettings, /fetchModels/);
    assert.match(liveSettings, /setModel/);
    assert.match(liveSettings, /setApprovalMode/);
    assert.match(liveSettings, /fetchLlmConfig/);
    assert.match(liveSettings, /saveLlmConfig/);
    assert.match(liveSettings, /data-live-settings/);
    assert.match(liveSettings, /LIVE_SETTINGS_SECTIONS|data-live-settings-nav/);
    assert.match(
      liveSettings,
      /data-live-settings-section=["']runtime_defaults["']|runtime_defaults/,
    );
    assert.match(
      liveSettings,
      /data-live-settings-section=["']llm["']|section === ["']llm["']/,
    );
    assert.doesNotMatch(liveSettings, /sk-draft-openai/);
    assert.doesNotMatch(liveSettings, /defaultApiConfig/);
    // Stable parent callback + mount-only load (no /api/meta loop)
    assert.match(liveSettings, /onMetaChangeRef/);
    assert.match(liveSettings, /lastPushedRef/);
    assert.match(liveSettings, /mount-only|deps \[\]|intentional mount/);
    const adapters = read("live/settings-adapters.ts");
    assert.match(adapters, /buildLiveSettingsSnapshot/);
    assert.match(adapters, /isDraftShowcaseApiKey/);
    assert.match(adapters, /LIVE_SETTINGS_SECTIONS/);
    assert.match(adapters, /withApprovalMode|isApprovalMode/);
    const api = read("api.ts");
    assert.match(api, /\/api\/config\/llm/);
    assert.match(api, /fetchLlmConfig|saveLlmConfig/);
  });

  it("App wires live ChatPanel + session portal + terminal + files", () => {
    assert.match(app, /ChatPanel/);
    assert.match(app, /threadRailId/);
    assert.match(app, /live-session-rail|LIVE_SESSION_RAIL/);
    assert.match(app, /className=["']wire-context["']|className=\{\s*["']wire-context["']|className:\s*["']wire-context["']/);
    assert.match(app, /chrome=["']wire["']|chrome:\s*["']wire["']/);
    assert.match(app, /TerminalPanel/);
    assert.match(app, /onOpenTerminal/);
    assert.match(app, /showFiles|onToggleFiles|FILES_ACTIVITY_ID/);
    assert.match(app, /ActivityBar|shell\.activity/);
    assert.match(app, /RightAside|wire-aside/);
    assert.match(app, /LeftAside|leftActivity/);
    assert.match(read("shell/ActivityBar.tsx"), /from\s+["']lucide-react["']/);
    assert.match(read("shell/activity.ts"), /SIDEBAR_ACTIVITY_ID/);
    assert.doesNotMatch(read("shell/activity.ts"), /SESSIONS_ACTIVITY_ID|智能体/);
    assert.match(read("shell/SidebarFrame.tsx"), /wire-v-split/);
    assert.match(read("shell/SidebarFrame.tsx"), /sidebar\.agents/);
    assert.match(read("shell/SidebarFrame.tsx"), /sidebar\.sessions/);
    assert.match(read("shell/AsidePane.tsx"), /is-animating/);
    assert.match(read("shell/WireShell.tsx"), /data-focus-region|ShellFocusContext/);
    assert.doesNotMatch(read("shell/WireShell.tsx"), /shell\.activity/);
    assert.match(app, /fetchMeta|onMetaChange/);
    assert.match(app, /fetchTerminals/);
    assert.match(app, /onTabChange|onDockTabChange/);
    assert.match(app, /is-hidden-mode|hidden=\{!chatVisible\}/);
    // Real terminal mounts in bottom dock 终端 card — not side float
    assert.match(app, /dockFaces|faces=\{dockFaces\}|TerminalPanelLazy/);
    assert.match(app, /openTabRequest|dockOpenReq/);
    assert.doesNotMatch(app, /wire-terminal-float|showTerminal/);
  });

  it("chat first-paint lazy-loads TerminalPanel and LiveProjectHost (not static default import)", () => {
    // Dynamic import boundaries — must not be static `import { TerminalPanel } from`
    assert.match(app, /lazy\s*\(/);
    assert.match(app, /import\s*\(\s*["']\.\.\/TerminalPanel["']\s*\)/);
    assert.match(app, /import\s*\(\s*["']\.\.\/live\/LiveProjectHost["']\s*\)/);
    assert.match(app, /import\s*\(\s*["']\.\.\/live\/ProactiveHost["']\s*\)/);
    assert.doesNotMatch(
      appEntry,
      /import\s*\{\s*TerminalPanel[^}]*\}\s*from\s*["']\.\/TerminalPanel["']/,
    );
    assert.doesNotMatch(
      appEntry,
      /import\s*\{\s*LiveProjectHost[^}]*\}\s*from\s*["']\.\/live\/LiveProjectHost["']/,
    );
    assert.doesNotMatch(
      appEntry,
      /import\s*\{\s*ProactiveHost[^}]*\}\s*from\s*["']\.\/live\/ProactiveHost["']/,
    );
    // Type-only import of OpenTerminalRequest is OK (erased at runtime)
    assert.match(app, /import\s+type\s+\{[^}]*OpenTerminalRequest/);
    // App must not import ProjectWorkbench via drafts barrel (CodeMirror path)
    assert.doesNotMatch(appEntry, /from\s+["']\.\/drafts["']/);
    assert.match(app, /from\s+["']\.\.\/drafts\/panels\/BottomInfoBar["']/);
    // Source editors are async-only
    const lazyEd = read("markdown/editor/LazySourceEditor.tsx");
    assert.match(lazyEd, /import\s*\(\s*["']\.\/SourceEditor["']\s*\)/);
    const workbench = read("drafts/panels/ProjectWorkbench.tsx");
    assert.match(workbench, /LazySourceEditor/);
    assert.doesNotMatch(
      workbench,
      /import\s*\{\s*SourceEditor\s*\}\s*from/,
    );
    const md = read("markdown/MarkdownWorkbench.tsx");
    assert.match(md, /LazySourceEditor/);
    assert.doesNotMatch(md, /import\s*\{\s*SourceEditor\s*\}\s*from/);
  });

  it("App agent rail uses liveAgentsToDraftAgents + fetchAgents not meta-only SoT", () => {
    assert.match(app, /fetchAgents/);
    assert.match(app, /liveAgentsToDraftAgents/);
    assert.match(app, /setActiveAgent/);
    assert.match(app, /onSelectAgent|liveAgentRows|activeSwitchId/);
    // Agent click remounts ChatPanel so sessions/history rebind
    assert.match(app, /key=\{activeSwitchId|remountKey:\s*activeSwitchId/);
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
    assert.match(chat, /wire-jump-bottom-dock/);
    assert.match(chat, /"plan"/);
    assert.match(chat, /"ultragoal"/);
    assert.match(chat, /wire-thread-stage/);
    assert.match(chat, /ThreadBoard|AskScrollRail/);
    assert.match(chat, /busy && !isWire/);
    assert.match(chat, /WireThreadView|groupThreadBlocks|chatLinesToDraftMessages/);
    assert.match(chat, /onDockLogLines/);
    assert.match(chat, /composer-tool-btn/);
    assert.match(chat, /ChromeMark/);
    assert.match(chat, /wire-composer-card/);
    assert.match(chat, /SessionTreeCrumbs/);
  });

  it("ThreadRail wire mode uses SessionList single-line rows (no thread-item mix)", () => {
    // Wire branch must not paint dual-class thread-item + wire-session-btn
    // (32px row + column flex clipped Chinese titles into garbage glyphs).
    assert.match(chat, /wire = SessionList single-line|SessionList single-line/);
    assert.match(chat, /className=\{`wire-session-row/);
    assert.match(chat, /className=["']wire-session-btn["']/);
    assert.match(chat, /className=["']wire-session-title["']/);
    assert.match(chat, /className=["']wire-session-time["']/);
    // Wire path must not apply thread-item to the same button
    const wireBranch = chat.slice(
      chat.indexOf("if (wire)"),
      chat.indexOf("return (", chat.indexOf("if (wire)") + 1),
    );
    assert.doesNotMatch(wireBranch, /thread-item/);
    assert.doesNotMatch(wireBranch, /thread-title/);
    assert.doesNotMatch(wireBranch, /thread-meta/);
  });

  it("App merges chat dock logs into BottomInfoBar", () => {
    assert.match(app, /onDockLogLines/);
    assert.match(app, /chatLogLines/);
    assert.match(app, /termLinesRaw|termLines/);
  });

  it("App stabilizes ChatPanel onMetaChange (no bootstrap thrash from polls)", () => {
    assert.match(app, /onChatMetaChange/);
    assert.match(app, /onMetaChange=\{onChatMetaChange\}|onMetaChange:\s*onChatMetaChange/);
    // Must not pass inline arrow that changes every App render
    assert.doesNotMatch(
      app,
      /onMetaChange=\{\(m\)\s*=>\s*\{[\s\S]*setMeta\(m\)/,
    );
    const chat = read("ChatPanel.tsx");
    // Mount-only bootstrap + ref for parent callbacks
    assert.match(chat, /onMetaChangeRef/);
    assert.match(chat, /intentional mount-only|mount-only bootstrap/i);
    assert.match(chat, /cancelled = true/);
  });

  it("App chat files rail uses LiveFilesRail (draft FilesRail + live FS)", () => {
    assert.match(app, /LiveFilesRail/);
    const liveFiles = read("live/LiveFilesRail.tsx");
    assert.match(liveFiles, /FilesRail/);
    assert.match(liveFiles, /fetchMdTree/);
    assert.match(liveFiles, /fetchProjectTree/);
    assert.match(liveFiles, /fetchGitStatus/);
    // Preview is opt-in after selection
    assert.match(liveFiles, /openPath/);
    assert.match(liveFiles, /关闭预览|setOpenPath\(null\)/);
    // 文件栏只读预览：DraftMarkdown + readFsFile（不要挂整台编辑工作台）
    assert.match(liveFiles, /DraftMarkdown/);
    assert.match(liveFiles, /readFsFile/);
    assert.match(liveFiles, /live-files-preview/);
    assert.doesNotMatch(
      liveFiles,
      /import\s*\(\s*["']\.\.\/markdown\/MarkdownWorkbench["']\s*\)/,
    );
    assert.doesNotMatch(
      liveFiles,
      /import\s*\{\s*MarkdownWorkbench/,
    );
  });

  it("App project mode uses LiveProjectHost (ProjectWorkbench + live FS)", () => {
    assert.match(app, /LiveProjectHost/);
    const liveProj = read("live/LiveProjectHost.tsx");
    assert.match(liveProj, /ProjectWorkbench/);
    assert.match(liveProj, /fetchMdTree|readFsFile/);
    assert.match(liveProj, /writeFsFile|onPersistMarkdown/);
    assert.match(liveProj, /project-host-docs|ensureContent|onActivePathChange/);
    const workbench = read("drafts/panels/ProjectWorkbench.tsx");
    assert.match(workbench, /onActivePathChange/);
  });

  it("ChatPanel usage uses fetchSessionStats", () => {
    assert.match(chat, /fetchSessionStats/);
    // Context chip opens modal — not append system line into thread
    assert.match(chat, /SessionUsageModal|usageModalOpen/);
    assert.doesNotMatch(
      chat,
      /usageClick[\s\S]{0,200}append\(\s*\{\s*id:[\s\S]{0,80}role:\s*["']system["']/,
    );
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
    assert.match(chat, /onForkSession|fork:\s*true/);
    assert.match(chat, /switchSession/);
    assert.match(chat, /answerApproval/);
    assert.match(chat, /setApprovalMode|setModel/);
    assert.match(chat, /exportTranscript|handleSlash|\/export/);
    assert.match(chat, /className/);
  });

  it("ChatPanel send mode toggle queue/insert + outbox + backend enqueue", () => {
    assert.match(chat, /ChatSendMode|sendMode/);
    assert.match(chat, /enqueueChat/);
    assert.match(chat, /cycleSendMode|send-mode-toggle/);
    assert.match(chat, /composer-outbox/);
    assert.match(chat, /interrupt_immediately|after_round_complete|insert/);
    assert.match(chat, /queued_user|queue_delivered/);
    // shortcuts: Enter / Ctrl+Enter insert / Alt+Enter cycle
    assert.match(chat, /send\(["']insert["']\)/);
    assert.match(chat, /altKey/);
  });

  it("TerminalPanel + api keep WS and list/stop", () => {
    assert.match(term, /agentTerminalWsUrl/);
    assert.match(term, /humanTerminalWsUrl/);
    assert.match(term, /新开壳/);
    assert.match(term, /fetchTerminals/);
    assert.match(term, /fetchTerminalCapabilities/);
    assert.match(term, /stopTerminal/);
    // wire shell chrome (not legacy AGENT TERMINALS / linkish)
    assert.match(term, /term-panel--wire/);
    assert.match(term, /term-toolbar|term-session-chip/);
    assert.doesNotMatch(term, /AGENT TERMINALS/);
    assert.doesNotMatch(term, /linkish/);
    assert.match(api, /\/api\/chat/);
    assert.match(api, /\/api\/chat\/abort/);
    assert.match(api, /\/api\/chat\/enqueue/);
    assert.match(api, /\/api\/chat\/queue/);
    assert.match(api, /\/api\/terminals/);
    assert.match(api, /\/ws\/agent-terminal/);
    assert.match(api, /\/ws\/terminal/);
    const createServer = read("../server/create-server.ts");
    assert.match(createServer, /\/ws\/terminal/);
    assert.match(createServer, /\/ws\/agent-terminal/);
    assert.doesNotMatch(createServer, /express\.static/);
    assert.match(createServer, /desktop client only/);
    const hub = read("../server/terminal-hub.ts");
    assert.match(hub, /openInteractive/);
    assert.match(hub, /resolveTerminalBackend/);
    assert.doesNotMatch(hub, /from\s+["']@lydell\/node-pty["']|from\s+["']node-pty["']/);
    assert.doesNotMatch(hub, /createRequire/);
    assert.match(mdApi, /\/api\/fs\/md-tree/);
    assert.match(mdApi, /\/api\/fs\/file/);
  });

  it("hotkeys Ctrl+B / Ctrl+` / Ctrl+Shift+F remain on App", () => {
    assert.match(app, /e\.key === ["']`["']/);
    assert.match(app, /toLowerCase\(\) === ["']b["']/);
    assert.match(app, /toLowerCase\(\) === ["']f["']/);
  });
});
