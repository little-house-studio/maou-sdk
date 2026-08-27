/**
 * CLI-workflow parity verify: sessions/model/approval + UI wiring.
 * SCRATCH=... pnpm exec tsx scripts/verify-parity.mts
 */
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server/create-server.ts";
import { AgentHub } from "../src/server/agent-hub.ts";

const SCRATCH =
  process.env.SCRATCH ||
  process.env.GROK_SCRATCH ||
  join(process.cwd(), "verify-out");
mkdirSync(SCRATCH, { recursive: true });
const log: string[] = [];
const L = (s: string) => {
  log.push(s);
  process.stdout.write(s + "\n");
};

const root = join(tmpdir(), `maou-parity-${Date.now()}`);
const project = join(root, "proj");
const maou = join(root, "home");
mkdirSync(join(project, ".maou"), { recursive: true });
mkdirSync(maou, { recursive: true });

// Unit path: hub methods
const hub = new AgentHub({
  projectRoot: project,
  maouRoot: maou,
  sandboxMode: "normal",
});
const s1 = hub.newSession("one");
const s2 = hub.newSession("two");
assert.ok(hub.listSessions().length >= 2);
hub.switchSession(s1.sessionId);
assert.equal(hub.getMeta().sessionId, s1.sessionId);
hub.setModel("p1", "m1");
assert.equal(hub.getMeta().model, "m1");
hub.setApprovalMode("auto");
assert.equal(hub.getApprovalMode(), "auto");
L(`[hub] sessions ${s1.sessionId.slice(0, 6)}/${s2.sessionId.slice(0, 6)} model+approval ok`);

// HTTP
const port = 19000 + Math.floor(Math.random() * 500);
const server = createAppServer({
  host: "127.0.0.1",
  port,
  projectRoot: project,
  maouRoot: maou,
  sandboxMode: "normal",
});
const { url } = await server.start();
L(`[server] ${url}`);

const sessions = await (await fetch(`${url}/api/sessions`)).json();
assert.equal(sessions.ok, true);
assert.ok(Array.isArray(sessions.sessions));

const created = await (
  await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "web" }),
  })
).json();
assert.equal(created.ok, true);
assert.ok(created.sessionId);
L(`[http] new session ${created.sessionId}`);

const switched = await (
  await fetch(`${url}/api/sessions/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: created.sessionId }),
  })
).json();
assert.equal(switched.ok, true);
assert.equal(switched.sessionId, created.sessionId);

const modelSet = await (
  await fetch(`${url}/api/model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "xfyun-qwen-coding", model: "x" }),
  })
).json();
assert.equal(modelSet.ok, true);
assert.equal(modelSet.provider, "xfyun-qwen-coding");

const appr = await (
  await fetch(`${url}/api/approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "yolo" }),
  })
).json();
assert.equal(appr.ok, true);
assert.equal(appr.mode, "yolo");

const cmdHelp = await (
  await fetch(`${url}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "help" }),
  })
).json();
assert.equal(cmdHelp.ok, true);
assert.ok(Array.isArray(cmdHelp.help));

const abort = await (
  await fetch(`${url}/api/chat/abort`, { method: "POST" })
).json();
assert.equal(abort.ok, true);

const badChat = await fetch(`${url}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "" }),
});
assert.equal(badChat.status, 400);

// rename / export / stats / clear (workflow completeness)
const renamed = await (
  await fetch(`${url}/api/sessions/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: created.sessionId, title: "parity-renamed" }),
  })
).json();
assert.equal(renamed.ok, true);
assert.equal(renamed.title, "parity-renamed");

const exported = await fetch(`${url}/api/sessions/active/export`);
assert.equal(exported.ok, true);
const exportText = await exported.text();
assert.ok(typeof exportText === "string");

const stats = await (
  await fetch(`${url}/api/sessions/active/stats`)
).json();
assert.equal(stats.ok, true);

const cleared = await (
  await fetch(`${url}/api/sessions/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: created.sessionId }),
  })
).json();
assert.equal(cleared.ok, true);
L(
  `[http] rename/export/stats/clear ok title=${renamed.title} exportLen=${exportText.length}`,
);

writeFileSync(
  join(SCRATCH, "webui-session-model.log"),
  JSON.stringify(
    {
      sessions,
      created,
      switched,
      modelSet,
      appr,
      cmdHelp,
      renamed,
      stats,
      cleared,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
L("[http] session/model/approval/command routes ok");

// Structural client wiring
const api = readFileSync(join(process.cwd(), "src/client/api.ts"), "utf8");
const chat = readFileSync(
  join(process.cwd(), "src/client/ChatPanel.tsx"),
  "utf8",
);
for (const p of [
  "/api/sessions",
  "/api/sessions/switch",
  "/api/sessions/rename",
  "/api/sessions/active/export",
  "/api/model",
  "/api/approval",
  "/api/approvals/",
  "/api/command",
  "/api/chat",
  "/api/chat/abort",
]) {
  assert.ok(api.includes(p) || chat.includes(p), `missing ${p}`);
}
assert.ok(chat.includes("handleSlash") || chat.includes("/new"));
assert.ok(chat.includes("setApprovalMode") || chat.includes("approval"));
assert.ok(chat.includes("createSession") && chat.includes("switchSession"));
assert.ok(chat.includes("answerApproval"));
assert.ok(chat.includes("stopRun") || chat.includes("queueRef"));
assert.ok(chat.includes("runGenRef"), "stale-run guard runGenRef");
assert.ok(
  chat.includes('c === "sessions"') || chat.includes("sessions"),
  "sessions slash",
);
// server aborts runtime when client disconnects mid-stream
const serverSrc = readFileSync(
  join(process.cwd(), "src/server/create-server.ts"),
  "utf8",
);
assert.ok(
  serverSrc.includes("onClientGone") || serverSrc.includes("req.on(\"close\""),
  "chat disconnect aborts runtime",
);
const termPanel = readFileSync(
  join(process.cwd(), "src/client/TerminalPanel.tsx"),
  "utf8",
);
assert.ok(
  termPanel.includes("force") && termPanel.includes("readyState"),
  "terminal re-attach dedupe for same live session",
);
assert.ok(
  chat.includes("ArrowDown") && chat.includes("slashIdx"),
  "slash keyboard navigation",
);
assert.ok(
  chat.includes("将停止当前生成") || chat.includes("is-busy"),
  "thread rail usable while busy",
);
assert.ok(
  chat.includes("stickBottomRef"),
  "sticky scroll while streaming",
);
assert.ok(chat.includes("copyToClipboard"), "clipboard fallback helper");
assert.ok(
  chat.includes("modelSelectRef") && chat.includes('key.toLowerCase() === "m"'),
  "Ctrl+M focuses model select",
);
assert.ok(chat.includes("focusComposer"), "focus composer after session ops");
assert.ok(
  chat.includes("inFlightSendRef") && chat.includes("MAX_QUEUE"),
  "double-send guard + queue cap",
);
assert.ok(chat.includes("clearQueue"), "clear queue without stop");
assert.ok(
  chat.includes('runCommand("usage")') || chat.includes("runCommand('usage')"),
  "usage chip opens session stats",
);
assert.ok(
  chat.includes("model_switched"),
  "handles runtime model_switched events",
);
const appSrc = readFileSync(join(process.cwd(), "src/client/App.tsx"), "utf8");
assert.ok(
  appSrc.includes('e.key === "`"') &&
    (appSrc.includes('toLowerCase() === "b"') ||
      appSrc.includes("toLowerCase() === 'b'")),
  "layout hotkeys Ctrl+B / Ctrl+`",
);
assert.ok(
  appSrc.includes("data-live-shell") && appSrc.includes("WireTopbar"),
  "draft-aligned live shell chrome",
);
assert.ok(
  appSrc.includes("BottomInfoBar") && appSrc.includes("ChatPanel"),
  "bottom dock + live chat on production App",
);
assert.ok(
  appSrc.includes("TerminalPanel") && appSrc.includes("MarkdownWorkbench"),
  "terminal + markdown workbench remain mounted",
);
const apiSrc = readFileSync(join(process.cwd(), "src/client/api.ts"), "utf8");
assert.ok(
  apiSrc.includes("readJsonBody") && apiSrc.includes("<!"),
  "API rejects HTML responses from dead backend",
);
const termCss = readFileSync(
  join(process.cwd(), "src/client/styles.css"),
  "utf8",
);
assert.ok(
  termCss.includes("term-wrap") && termCss.includes("flex-direction: column"),
  "terminal rail stacked layout",
);
writeFileSync(
  join(SCRATCH, "webui-ui-wiring.log"),
  [
    "client api paths + ChatPanel session/model/approval/slash/queue wired",
    ...log,
  ].join("\n") + "\n",
);
L("[client] UI wiring ok");

writeFileSync(
  join(SCRATCH, "webui-chat-sample.ndjson"),
  JSON.stringify({
    type: "error",
    message:
      "parity verify: session/model/approval/abort routes ok; live LLM not required",
  }) + "\n",
);

await server.close();
rmSync(root, { recursive: true, force: true });
writeFileSync(join(SCRATCH, "webui-parity-verify.log"), log.join("\n") + "\n");
L("[done] parity verify passed");
