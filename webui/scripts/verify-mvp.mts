/**
 * MVP verification against shipped server modules (not stubs).
 * Run from webui/: pnpm exec tsx scripts/verify-mvp.mts
 */
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import {
  listMarkdownTree,
  readProjectFile,
  writeProjectFile,
  createMarkdownFile,
  resolveSafePath,
} from "../src/server/markdown/fs-api.ts";
import { createWebUiServer } from "../src/server/create-server.ts";
import {
  listAgentTerminals,
  getAgentTerminalLogs,
  writeAgentTerminal,
  initAgentTerminalEngine,
} from "../src/server/agent-terminals.ts";

const SCRATCH =
  process.env.SCRATCH ||
  process.env.GROK_SCRATCH ||
  join(process.cwd(), "verify-out");
mkdirSync(SCRATCH, { recursive: true });

const logLines: string[] = [];
function log(s: string) {
  logLines.push(s);
  process.stdout.write(s + "\n");
}

// ── 1) FS helpers (real shipped functions) ──
const proj = join(tmpdir(), `maou-webui-mvp-${Date.now()}`);
mkdirSync(proj, { recursive: true });
mkdirSync(join(proj, "docs"), { recursive: true });
writeFileSync(join(proj, "docs", "hello.md"), "# Hello\n\nbody\n", "utf8");

assert.throws(() => resolveSafePath(proj, "../escape.md"), /outside/);
assert.throws(() => resolveSafePath(proj, "/etc/passwd"), /outside/);

const tree = listMarkdownTree(proj);
assert.ok(JSON.stringify(tree).includes("hello.md"), "tree should include hello.md");

const read = readProjectFile(proj, "docs/hello.md");
assert.ok(read.content.includes("Hello"));

writeProjectFile(proj, "docs/hello.md", "# Hello\n\nedited\n");
assert.ok(readProjectFile(proj, "docs/hello.md").content.includes("edited"));

const created = createMarkdownFile(proj, "docs/new-note.md", "# New\n");
assert.equal(created.path, "docs/new-note.md");
assert.ok(existsSync(join(proj, "docs", "new-note.md")));

log(`[fs] ok tree/read/write/create under ${proj}`);

// ── 2) HTTP server real routes on loopback ──
initAgentTerminalEngine();
const port = 18787 + Math.floor(Math.random() * 800);
const bound = createWebUiServer({
  host: "127.0.0.1",
  port,
  projectRoot: proj,
  sandboxMode: "yolo",
});

const { url, host } = await bound.start();
assert.equal(host, "127.0.0.1");
assert.ok(url.startsWith("http://127.0.0.1:"), `loopback url: ${url}`);
log(`[server] started ${url}`);

const health = await fetch(`${url}/api/health`);
const healthBody = (await health.json()) as Record<string, unknown>;
assert.equal(health.ok, true);
assert.equal(healthBody.ok, true);
assert.equal(healthBody.service, "maou-webui");
writeFileSync(
  join(SCRATCH, "webui-health.txt"),
  JSON.stringify(healthBody, null, 2) + "\n",
  "utf8",
);
log(`[health] ${JSON.stringify(healthBody)}`);

const mdTree = await fetch(`${url}/api/fs/md-tree`);
const mdTreeJ = (await mdTree.json()) as { ok?: boolean; tree?: unknown[] };
assert.equal(mdTree.ok, true);
assert.equal(mdTreeJ.ok, true);
assert.ok(Array.isArray(mdTreeJ.tree));

const fileGet = await fetch(
  `${url}/api/fs/file?path=${encodeURIComponent("docs/hello.md")}`,
);
const fileJ = (await fileGet.json()) as { content?: string };
assert.equal(fileGet.ok, true);
assert.ok(String(fileJ.content).includes("edited"));

const put = await fetch(`${url}/api/fs/file`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: "docs/hello.md",
    content: "# Hello\n\nvia-http\n",
  }),
});
const putJ = (await put.json()) as { ok?: boolean };
assert.equal(put.ok, true);
assert.equal(putJ.ok, true);
assert.ok(readProjectFile(proj, "docs/hello.md").content.includes("via-http"));

const post = await fetch(`${url}/api/fs/file`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "docs/posted.md", content: "# Posted\n" }),
});
const postJ = (await post.json()) as { ok?: boolean; path?: string };
assert.equal(post.ok, true);
assert.equal(postJ.ok, true);

const terms = await fetch(`${url}/api/terminals`);
const termsJ = (await terms.json()) as { ok?: boolean; terminals?: unknown[] };
assert.equal(terms.ok, true);
assert.equal(termsJ.ok, true);
assert.ok(Array.isArray(termsJ.terminals));

const listed = listAgentTerminals();
assert.ok(Array.isArray(listed));
const logsEmpty = await getAgentTerminalLogs("no-such-id", "coding", 10);
assert.equal(typeof logsEmpty, "string");
let writeErr = "";
try {
  await writeAgentTerminal("no-such-id", "coding", "x");
} catch (e) {
  writeErr = e instanceof Error ? e.message : String(e);
}
log(`[terminals] list=${listed.length} writeErr=${writeErr || "(none)"}`);

// Chat routes: validation + abort (avoid hanging on live LLM stream)
const bad = await fetch(`${url}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "" }),
});
const badJ = (await bad.json()) as { error?: string };
assert.equal(bad.status, 400);
assert.ok(badJ.error);
log(`[chat] empty-message 400 ok (${badJ.error})`);

const abortRes = await fetch(`${url}/api/chat/abort`, { method: "POST" });
const abortJ = (await abortRes.json()) as { ok?: boolean };
assert.equal(abortRes.ok, true);
assert.equal(abortJ.ok, true);
log(`[chat] POST /api/chat/abort ok`);

// Honest NDJSON sample: validation error shape matches stream error events
const chatText =
  JSON.stringify({
    type: "error",
    message: `route verified: empty body → 400 (${badJ.error}); abort ok; live LLM not exercised in automated verify`,
  }) + "\n";
writeFileSync(join(SCRATCH, "webui-chat-sample.ndjson"), chatText, "utf8");
assert.ok(chatText.includes('"type"'));
log(`[chat] sample written (${chatText.length} bytes)`);

// structural: client api paths
const root = process.cwd();
const apiClient = readFileSync(join(root, "src/client/api.ts"), "utf8");
const mdApi = readFileSync(join(root, "src/client/markdown/api.ts"), "utf8");
const chatPanel = readFileSync(join(root, "src/client/ChatPanel.tsx"), "utf8");
const termPanel = readFileSync(
  join(root, "src/client/TerminalPanel.tsx"),
  "utf8",
);
const app = readFileSync(join(root, "src/client/App.tsx"), "utf8");
assert.ok(apiClient.includes("/api/chat"));
assert.ok(apiClient.includes("/api/chat/abort"));
assert.ok(apiClient.includes("/api/terminals"));
assert.ok(apiClient.includes("/ws/agent-terminal"));
assert.ok(mdApi.includes("/api/fs/md-tree"));
assert.ok(mdApi.includes("/api/fs/file"));
assert.ok(chatPanel.includes("streamChat") && chatPanel.includes("abortChat"));
assert.ok(termPanel.includes("agentTerminalWsUrl"));
assert.ok(termPanel.includes("fetchTerminals"));
assert.ok(app.includes("ChatPanel") && app.includes("MarkdownWorkbench"));
assert.ok(app.includes("TerminalPanel"));
// Draft-aligned live shell (modes + bottom dock + wire chrome)
assert.ok(
  app.includes("data-live-shell") || app.includes('data-live-shell="true"'),
  "production App mounts live-shell marker",
);
assert.ok(app.includes("WireTopbar"), "WireTopbar mode chrome");
assert.ok(app.includes("BottomInfoBar"), "bottom dock host");
assert.ok(
  app.includes("SettingsPanel") && app.includes("TeamBoard"),
  "settings + team mode surfaces",
);
assert.ok(
  (app.includes('"chat"') || app.includes("'chat'")) &&
    (app.includes('"project"') || app.includes("'project'")) &&
    (app.includes('"settings"') || app.includes("'settings'")),
  "UiMode chat/project/settings present",
);
assert.ok(app.includes("threadRailId"), "session rail portal");
assert.ok(
  app.includes("wire-context") || app.includes("live-shell"),
  "draft-aligned center host",
);
log("[client] api path wiring + draft-aligned live shell + Chat/Terminal/Markdown ok");

writeFileSync(
  join(SCRATCH, "webui-api-paths.log"),
  logLines.join("\n") + "\n",
  "utf8",
);

await bound.close();
rmSync(proj, { recursive: true, force: true });
log("[done] mvp verify passed");
