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
    assert.match(app, /SettingsPanel/);
    assert.match(app, /TeamBoard/);
    assert.match(app, /MarkdownWorkbench/);
  });

  it("App wires live ChatPanel + session portal + terminal + files", () => {
    assert.match(app, /ChatPanel/);
    assert.match(app, /threadRailId/);
    assert.match(app, /live-session-rail|LIVE_SESSION_RAIL/);
    assert.match(app, /className=["']wire-context["']|className=\{\s*["']wire-context["']/);
    assert.match(app, /TerminalPanel/);
    assert.match(app, /onOpenTerminal/);
    assert.match(app, /showFiles|onToggleFiles/);
    assert.match(app, /fetchMeta|onMetaChange/);
    assert.match(app, /fetchTerminals/);
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
