import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Browser, type Page } from "playwright";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
let server: PreviewServer;
let fixtureDir: string;
let browser: Browser;
let base: string;
const pageErrors: string[] = [];
before(async () => {
  fixtureDir = await mkdtemp(resolve(tmpdir(), "maou-interactions-"));
  await build({
    configFile: false,
    root: resolve(appRoot, "scripts/fixtures"),
    plugins: [react()],
    logLevel: "error",
    build: { outDir: fixtureDir, emptyOutDir: true, minify: false, cssMinify: false, rollupOptions: { input: resolve(appRoot, "scripts/fixtures/interactions.html") } },
  });
  server = await preview({
    configFile: false,
    root: resolve(appRoot, "scripts/fixtures"),
    build: { outDir: fixtureDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ headless: true });
}, { timeout: 600000 });
afterEach(async () => {
  for (const page of browser?.contexts().flatMap((c) => c.pages()) ?? []) await page.close();
  assert.deepEqual(pageErrors.splice(0), [], "uncaught browser exceptions");
});
after(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => server.httpServer.close((e) => e ? reject(e) : resolve()));
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});
async function open(kind: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", (e) => pageErrors.push(`${kind}: ${e.message}`));
  await page.goto(`${base}interactions.html?case=${kind}`);
  await page.waitForFunction(() => !!(window as any).audit);
  return page;
}
async function calls(page: Page, name: string) { return page.evaluate((name) => (window as any).audit.calls.filter((c: any) => c.name === name), name); }
async function settle(page: Page, name: string, value?: unknown, reject = false) {
  await page.evaluate(({ name, value, reject }) => reject ? (window as any).audit.reject(name) : (window as any).audit.resolve(name, value), { name, value, reject });
}
async function waitCalls(page: Page, name: string, count = 1) {
  await page.waitForFunction(({ name, count }) => (window as any).audit.calls.filter((c: any) => c.name === name).length >= count, { name, count });
}

test("composer tools preserve local draft and sending clears it", async () => {
  const page = await open("composer");
  const input = page.getByRole("textbox", { name: "消息" });
  await input.fill("尚未同步的草稿");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "计划模式" }).click();
  assert.match(await input.inputValue(), /尚未同步的草稿/);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
  assert.equal((await calls(page, "send")).length, 1);
  await page.close();
});

test("stop stays available while typing during generation", async () => {
  const page = await open("composer");
  await page.getByRole("button", { name: "模拟运行" }).click();
  await page.getByRole("textbox", { name: "消息" }).fill("follow-up");
  await page.getByRole("button", { name: "停止", exact: true }).click();
  assert.equal((await calls(page, "stop")).length, 1);
  await page.close();
});

test("model picker ignores stale responses and never selects an old model for a new provider", async () => {
  const page = await open("models");
  await page.getByRole("button").click();
  await page.getByRole("menuitem", { name: "b", exact: true }).hover();
  await waitCalls(page, "models:b");
  assert.equal(await page.getByRole("menuitem", { name: "a1", exact: true }).count(), 0);
  await page.getByRole("menuitem", { name: "c", exact: true }).hover();
  await waitCalls(page, "models:c");
  await settle(page, "models:c", { models: [{ id: "c1" }] });
  await page.getByRole("menuitem", { name: "c1", exact: true }).waitFor();
  await settle(page, "models:b", { models: [{ id: "b1" }] });
  await page.getByRole("menuitem", { name: "c1", exact: true }).click();
  assert.deepEqual((await calls(page, "modelSelect"))[0].args, ["c", "c1"]);
  await page.close();
});

async function sourceEditor(page: Page) {
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  return page.locator(".cm-content");
}
test("failed document save keeps dirty state and retry writes the draft", async () => {
  const page = await open("project");
  const editor = await sourceEditor(page);
  await editor.fill("# Changed");
  await page.getByRole("button", { name: "同步", exact: true }).click();
  await waitCalls(page, "write:a.md");
  await settle(page, "write:a.md", undefined, true);
  await page.getByRole("button", { name: "同步", exact: true }).waitFor();
  assert.equal(await page.getByLabel("未保存改动").count(), 1);
  await page.getByRole("button", { name: "同步", exact: true }).click();
  await waitCalls(page, "write:a.md", 2);
  await settle(page, "write:a.md");
  await page.waitForFunction(() => !document.querySelector('[aria-label="未保存改动"]'));
  assert.deepEqual((await calls(page, "write")).map((c: any) => c.args), [["a.md", "# Changed"], ["a.md", "# Changed"]]);
  await page.close();
});

test("edits typed during saving stay dirty, and clearing a file survives refresh", async () => {
  const page = await open("project");
  const editor = await sourceEditor(page);
  await editor.fill("first version");
  await page.getByRole("button", { name: "同步", exact: true }).click();
  await waitCalls(page, "write:a.md");
  await editor.fill("");
  await page.getByRole("button", { name: "刷新文档列表" }).click();
  await settle(page, "write:a.md");
  assert.equal((await editor.innerText()).trim(), "");
  assert.equal(await page.getByLabel("未保存改动").count(), 1);
  await page.close();
});

test("Shift+Tab keeps normal focus navigation; hidden chat ignores shortcuts", async () => {
  const page = await open("chat");
  await page.getByRole("textbox", { name: "消息" }).fill("draft");
  await page.keyboard.press("Shift+Tab");
  assert.equal((await calls(page, "approvalMode")).length, 0);
  await page.getByRole("button", { name: "切换聊天可见性" }).click();
  await page.getByRole("textbox", { name: "外部输入框" }).focus();
  await page.keyboard.press("Control+n");
  assert.equal((await calls(page, "createSession")).length, 0);
  await page.close();
});

test("failed new session reports failure, unlocks input and does not lose draft", async () => {
  const page = await open("chat");
  const input = page.getByRole("textbox", { name: "消息" });
  await input.fill("keep my draft");
  await page.keyboard.press("Control+n");
  await waitCalls(page, "createSession");
  await page.keyboard.press("Control+n");
  assert.equal((await calls(page, "createSession")).length, 1);
  await settle(page, "createSession", undefined, true);
  await page.waitForFunction(() => !document.querySelector("textarea")?.disabled);
  assert.equal(await input.inputValue(), "keep my draft");
  assert.match(await page.locator(".composer-status").getAttribute("title") || "", /会话操作失败/);
  await page.close();
});

test("failed queue removal and clear keep the message visible", async () => {
  const page = await open("chat");
  const input = page.getByRole("textbox", { name: "消息" });
  await input.fill("run"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await waitCalls(page, "send");
  await input.fill("queued message"); await page.getByRole("button", { name: "排队发送", exact: true }).click();
  await waitCalls(page, "enqueue");
  await page.getByRole("button", { name: "移除排队消息" }).click();
  await waitCalls(page, "removeQueue"); await settle(page, "removeQueue", undefined, true);
  await page.waitForFunction(() => document.querySelector(".composer-status")?.getAttribute("title")?.includes("移除失败"));
  assert.equal(await page.locator(".composer-queue-item").count(), 1);
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  await waitCalls(page, "clearQueue"); await settle(page, "clearQueue", undefined, true);
  await page.waitForFunction(() => document.querySelector(".composer-status")?.getAttribute("title")?.includes("清空失败"));
  assert.equal(await page.locator(".composer-queue-item").count(), 1);
  await page.close();
});

test("failed Agent switch preserves active workspace and exposes an error", async () => {
  const page = await open("host");
  await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("coding"));
  const before = await page.locator("output").textContent();
  await page.getByRole("button", { name: "选择 ops" }).click();
  await waitCalls(page, "setActiveAgent"); await settle(page, "setActiveAgent", undefined, true);
  await page.getByRole("alert").filter({ hasText: "切换 Agent 失败" }).waitFor();
  assert.equal(await page.locator("output").textContent(), before);
  await page.close();
});

test("approval shortcut answers only the focused card and failed decisions can retry", async () => {
  const page = await open("approvals");
  const cards = page.getByRole("alertdialog");
  await cards.nth(0).getByRole("button", { name: "1允许一次" }).focus();
  await page.keyboard.press("1");
  await waitCalls(page, "decision");
  assert.deepEqual((await calls(page, "decision")).map((c: any) => c.args), [["one", "once"]]);
  await settle(page, "decision:one", undefined, true);
  await cards.nth(0).getByRole("alert").waitFor();
  await cards.nth(0).getByRole("button", { name: "1允许一次" }).click();
  await waitCalls(page, "decision", 2);
  await page.close();
});

test("modal traps Tab focus, Escape closes it and focus returns to the opener", async () => {
  const page = await open("modal");
  const opener = page.getByRole("button", { name: "打开统计" });
  await opener.click();
  const modal = page.getByRole("dialog");
  await modal.waitFor();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement)));
  await page.keyboard.press("Shift+Tab");
  assert.ok(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  assert.equal(await modal.count(), 0);
  assert.ok(await opener.evaluate((el) => el === document.activeElement));
  await page.close();
});

test("save all writes every dirty document and keeps only failed writes dirty", async () => {
  const page = await open("project");
  const editor = await sourceEditor(page);
  await editor.fill("changed A");
  await page.locator('.wire-project-tree-row[data-project-path="b.md"]').click();
  await editor.fill("changed B");
  await page.getByRole("button", { name: "全同步", exact: true }).click();
  await waitCalls(page, "write", 2);
  await settle(page, "write:a.md");
  await settle(page, "write:b.md", undefined, true);
  await page.waitForFunction(() => document.querySelector(".wire-project-dirty-count")?.textContent?.trim() === "1 改动");
  assert.equal(await page.getByLabel("未保存改动").count(), 1);
  await page.close();
});

test("terminal ignores old connection messages and cancels reconnect on switch and unmount", async () => {
  const page = await open("terminal");
  await waitCalls(page, "socket");
  await page.evaluate(() => (window as any).audit.sockets[0].close());
  await page.getByRole("tab", { name: /first/ }).click();
  await waitCalls(page, "socket", 2);
  await page.evaluate(() => (window as any).audit.sockets[0].emit({ type: "error", message: "STALE" }));
  await page.waitForTimeout(900);
  assert.equal((await calls(page, "socket")).length, 2);
  assert.doesNotMatch(await page.locator(".term-status").innerText(), /错误/);
  await page.evaluate(() => (window as any).audit.sockets[1].close());
  await page.getByRole("button", { name: "卸载终端" }).click();
  await page.waitForTimeout(900);
  assert.equal((await calls(page, "socket")).length, 2);
  await page.close();
});

test("unreadable project document stays read-only until a successful retry", async () => {
  const page = await open("live-project");
  await waitCalls(page, "readDoc");
  await settle(page, "readDoc", undefined, true);
  await waitCalls(page, "readDoc", 2);
  await settle(page, "readDoc", undefined, true);
  await page.getByRole("alert").waitFor();
  await page.getByRole("tab", { name: "源码", exact: true }).click();
  await page.locator('.cm-content[contenteditable="false"]').waitFor();
  assert.equal((await calls(page, "write")).length, 0);
  await page.getByRole("button", { name: "重试读取" }).click();
  await waitCalls(page, "readDoc", 3);
  await settle(page, "readDoc", { path: "a.md", content: "# Recovered" });
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  assert.match(await page.locator(".cm-content").innerText(), /Recovered/);
  await page.close();
});

test("plugin HTTP failure is visible and preserves plugin state", async () => {
  const page = await browser.newPage();
  page.on("pageerror", (e) => pageErrors.push(`plugins: ${e.message}`));
  await page.route("**/api/plugins", (route) => route.fulfill({ json: { plugins: [{ id: "p", name: "Plugin", phase: "ready", enabled: true }] } }));
  await page.route("**/api/plugins/toggle", (route) => route.fulfill({ status: 500, json: { error: "failure" } }));
  await page.goto(`${base}interactions.html?case=plugins`);
  await page.getByRole("checkbox").click();
  await page.getByRole("alert").filter({ hasText: "插件操作失败" }).waitFor();
  assert.equal(await page.getByRole("checkbox").isChecked(), true);
  await page.close();
});

test("settings draft survives mode switches and the hidden panel cannot close the current page", async () => {
  const page = await open("app");
  await page.getByRole("tab", { name: "设置", exact: true }).click();
  await page.locator('[data-live-settings-nav="llm"]').click();
  await page.getByRole("button", { name: "+ 添加自定义", exact: true }).click();
  const id = page.locator('input[title="稳定身份：settings /model / roles / keyRef"]');
  await id.fill("unsaved-provider");
  await page.getByRole("tab", { name: "聊天", exact: true }).click();
  assert.equal(await page.locator('[data-live-region="settings"]').isVisible(), false);
  await page.getByRole("tab", { name: "设置", exact: true }).click();
  assert.equal(await id.inputValue(), "unsaved-provider");
  await page.screenshot({ path: resolve(tmpdir(), "maou-settings-interactions.png"), fullPage: true });
  await page.getByRole("tab", { name: "项目", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-ui-mode="project"]').count(), 1);
  await page.getByRole("tab", { name: "聊天", exact: true }).click();
  await page.getByRole("textbox", { name: "消息" }).fill("继续编辑草稿");
  await page.setViewportSize({ width: 1024, height: 720 });
  const sendBox = await page.getByRole("button", { name: "发送", exact: true }).boundingBox();
  assert.ok(sendBox && sendBox.x >= 0 && sendBox.x + sendBox.width <= 1024 && sendBox.y + sendBox.height <= 720);
  await page.screenshot({ path: resolve(tmpdir(), "maou-chat-interactions.png"), fullPage: true });
  await page.close();
});

test("quickly leaving a document preserves an intentionally empty draft", async () => {
  const page = await open("project");
  const editor = await sourceEditor(page);
  await editor.fill("");
  await page.getByRole("button", { name: "切换文档挂载" }).click();
  await page.getByRole("button", { name: "切换文档挂载" }).click();
  await page.locator(".cm-content").waitFor();
  assert.equal((await page.locator(".cm-content").innerText()).trim(), "");
  assert.equal(await page.getByLabel("未保存改动").count(), 1);
});

test("unread document placeholders cannot become persisted empty edits", async () => {
  const page = await open("project-stub");
  await page.getByRole("button", { name: "重新打开文档" }).click();
  await page.getByRole("button", { name: "完成加载" }).click();
  const editor = await sourceEditor(page);
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent?.includes("Loaded document"));
  assert.equal(await page.getByLabel("未保存改动").count(), 0);
  assert.match(await editor.innerText(), /Loaded document/);
});

test("proactive chat ignores IME Enter and preserves failed messages across polling", async () => {
  const page = await open("proactive");
  const input = page.locator(".proactive-composer input");
  await input.fill("待重试的消息");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  assert.equal((await calls(page, "proactiveSend")).length, 0);
  await input.press("Enter");
  await page.getByRole("alert").filter({ hasText: "Provider unavailable" }).waitFor();
  assert.equal(await input.inputValue(), "待重试的消息");
  await page.waitForTimeout(2200);
  assert.match(await page.getByRole("alert").innerText(), /Provider unavailable/);
});

test("folder browsing ignores stale listings and opening failure remains retryable", async () => {
  const page = await browser.newPage();
  page.on("pageerror", (e) => pageErrors.push(`folders: ${e.message}`));
  let releaseA: (() => void) | undefined;
  await page.route("**/api/fs/browse*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (path === "/a") await new Promise<void>((resolve) => { releaseA = resolve; });
    await route.fulfill({ json: { path: path || "/", parent: path ? "/" : null, entries: path ? [] : [{ name: "A", path: "/a" }, { name: "B", path: "/b" }] } });
  });
  await page.route("**/api/project/open", (route) => route.fulfill({ status: 500, json: { ok: false, error: "Open failed" } }));
  await page.goto(`${base}interactions.html?case=folders`);
  await page.getByRole("button", { name: "A", exact: true }).click();
  await page.getByRole("button", { name: "B", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".wire-folder-path")?.textContent === "/b");
  releaseA?.();
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".wire-folder-path").innerText(), "/b");
  await page.locator(".wire-folder-acts button").last().click();
  await page.getByRole("alert").filter({ hasText: "Open failed" }).waitFor();
  assert.equal(await page.locator(".wire-folder-acts button").last().isEnabled(), true);
});

test("failed chat stop keeps the running state and allows retry", async () => {
  const page = await open("chat");
  await page.getByRole("textbox", { name: "消息" }).fill("run");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await waitCalls(page, "send");
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await waitCalls(page, "abort");
  await settle(page, "abort", undefined, true);
  await page.waitForFunction(() => document.querySelector(".composer-status")?.getAttribute("title")?.includes("停止失败"));
  assert.equal(await page.getByRole("button", { name: "停止", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await waitCalls(page, "abort", 2);
  await settle(page, "abort");
  await page.waitForFunction(() => !document.querySelector('[aria-label="停止"]'));
});

test("queue hydrates, edits with keyboard, reorders and promotes without replacing identity", async () => {
  const page = await open("queue");
  await page.evaluate(() => (window as any).audit.setQueue(["first message", "second message"], true));
  await page.getByRole("button", { name: "刷新队列", exact: true }).click();
  const rows = page.locator(".composer-queue-item");
  await rows.nth(1).waitFor();
  await rows.nth(1).getByRole("button", { name: "编辑排队消息", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑排队消息内容" });
  await editor.fill("edited message\nsecond line");
  await editor.press("Control+Enter");
  await page.waitForFunction(() => document.querySelectorAll(".composer-queue-text")[1]?.textContent?.includes("edited message"));
  await rows.nth(1).getByRole("button", { name: "上移排队消息" }).click();
  await page.waitForFunction(() => document.querySelector(".composer-queue-text")?.textContent?.includes("edited message"));
  await rows.first().getByRole("button", { name: "插入", exact: true }).click();
  await rows.first().getByText("优先插入", { exact: true }).waitFor();
  const state = await page.evaluate(() => (window as any).audit.queue());
  assert.deepEqual(state.queue.map((o: any) => o.id), [2, 1]);
  assert.equal((await calls(page, "enqueue")).length, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/maou-queue-mobile.png", fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

test("queue preserves duplicate texts and handles consumption before enqueue acknowledgement", async () => {
  const page = await open("queue");
  await page.getByRole("button", { name: "添加相同消息" }).click();
  await page.getByRole("button", { name: "添加相同消息" }).click();
  await page.locator(".composer-queue-item").nth(1).waitFor();
  await page.evaluate(() => (window as any).audit.consume(1));
  await page.waitForFunction(() => document.querySelectorAll(".composer-queue-item").length === 1);
  await page.evaluate(() => { (window as any).audit.holdEnqueue = true; });
  await page.getByRole("button", { name: "添加相同消息" }).click();
  await waitCalls(page, "enqueueAck");
  await page.evaluate(() => (window as any).audit.consume(3));
  await settle(page, "enqueueAck");
  await page.waitForFunction(() => document.querySelectorAll(".composer-queue-item").length === 1);
  assert.equal(await page.locator(".composer-queue-text").textContent(), "相同内容");
});

test("queue ignores late acknowledgement after switching sessions", async () => {
  const page = await open("queue");
  await page.evaluate(() => { (window as any).audit.holdEnqueue = true; });
  await page.getByRole("button", { name: "添加相同消息" }).click();
  await waitCalls(page, "enqueueAck");
  await page.getByRole("button", { name: "切换队列会话" }).click();
  await settle(page, "enqueueAck");
  await page.getByRole("button", { name: "刷新队列", exact: true }).click();
  assert.equal(await page.locator(".composer-queue-item").count(), 0);
});

test("queue clear requires confirmation and editing cancel preserves original content", async () => {
  const page = await open("queue");
  await page.evaluate(() => (window as any).audit.setQueue(["original"], false));
  await page.getByRole("button", { name: "刷新队列", exact: true }).click();
  await page.getByRole("button", { name: "编辑排队消息", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑排队消息内容" });
  await editor.fill("discard"); await editor.press("Escape");
  assert.equal(await page.locator(".composer-queue-text").textContent(), "original");
  await page.getByRole("button", { name: "清空", exact: true }).click();
  assert.equal((await calls(page, "clearQueue")).length, 0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator(".composer-queue-item").count(), 1);
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await page.getByRole("button", { name: "确认清空", exact: true }).click();
  await waitCalls(page, "clearQueue"); await settle(page, "clearQueue");
  await page.waitForFunction(() => !document.querySelector(".composer-queue-item"));
});

test("stopping a chat retains pending messages and resume uses server-owned queue", async () => {
  const page = await open("chat");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("start"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await waitCalls(page, "send");
  await input.fill("pending"); await page.getByRole("button", { name: "排队发送", exact: true }).click();
  await page.locator(".composer-queue-item").waitFor();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await waitCalls(page, "abort"); await settle(page, "abort");
  await page.getByRole("button", { name: "继续发送", exact: true }).click();
  await waitCalls(page, "send", 2);
  assert.deepEqual((await calls(page, "abortArgs"))[0].args, ["s1", true]);
  assert.equal((await calls(page, "removeQueue")).length, 0);
  assert.equal((await calls(page, "send"))[1].args[0].resumeQueue, true);
  await page.waitForFunction(() => !document.querySelector(".composer-queue-item"));
});

test("failed queue drafts survive reload and retry keeps request identity", async () => {
  const page = await open("queue");
  await page.evaluate(() => { (window as any).audit.rejectEnqueue = true; });
  await page.getByRole("button", { name: "添加相同消息" }).click();
  await page.locator(".composer-queue-error").filter({ hasText: "队列暂不可用" }).waitFor();
  const requestId = (await calls(page, "enqueue"))[0].args[2].requestId;
  await page.reload();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("等待处理", { exact: true }).waitFor();
  assert.equal((await calls(page, "enqueue"))[0].args[2].requestId, requestId);
  assert.equal(await page.locator(".composer-queue-item").count(), 1);
});

test("queue in actual chat stays readable at desktop and narrow widths", async () => {
  const page = await open("chat");
  await page.evaluate(() => (window as any).audit.setQueue(["先整理当前项目的交互问题，列出可以复现的步骤。", "修复完成后运行回归测试，保留完整的验证结果。"], false));
  await page.locator(".composer-queue-item").nth(1).waitFor();
  await page.screenshot({ path: "/tmp/maou-queue-chat-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 420, height: 860 });
  await page.screenshot({ path: "/tmp/maou-queue-chat-mobile.png", fullPage: true });
  assert.ok(await page.locator(".composer-queue").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
});

test("reloading during enqueue confirmation preserves the unsent draft", async () => {
  const page = await open("queue");
  await page.evaluate(() => { (window as any).audit.holdEnqueue = true; });
  await page.getByRole("button", { name: "添加相同消息" }).click();
  await waitCalls(page, "enqueueAck");
  const requestId = (await calls(page, "enqueue"))[0].args[2].requestId;
  await page.reload();
  await page.locator(".composer-queue-error").filter({ hasText: "入队确认中断" }).waitFor();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByText("等待处理", { exact: true }).waitFor();
  assert.equal((await calls(page, "enqueue"))[0].args[2].requestId, requestId);
});
