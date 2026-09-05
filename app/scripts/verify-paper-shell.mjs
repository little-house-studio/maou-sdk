import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.MAOU_PAPER_OUT || "/tmp/maou-paper-shell";
const BASE = (
  process.env.MAOU_APP_RENDERER_URL?.trim() || "http://127.0.0.1:5173/"
).replace(/\/$/, "");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitVite() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/draft.html`, {
        headers: { "User-Agent": "Electron" },
      });
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`vite not up at ${BASE}`);
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  writeFileSync(join(OUT, `${name}.png`), img.toPNG());
}

function evalPage(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

function clickLabel(win, selector, text) {
  return evalPage(
    win,
    `(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = nodes.find((n) => (n.textContent || "").includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
}

function inspect(win) {
  return evalPage(
    win,
    `(() => {
      const shell = document.querySelector(".wire-shell.draft-shell");
      if (!shell) return { ok: false, reason: "no-shell" };
      const cs = getComputedStyle(shell);
      const top = document.querySelector(".wire-topbar");
      const left = document.querySelector(".wire-left");
      const right = document.querySelector(".wire-right");
      const bottom = document.querySelector(".wire-bottom-dock, .wire-bottom-bar");
      const composer = document.querySelector(".composer-row");
      const meta = document.querySelector(".wire-meta");
      const hex = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
      const rgbToHex = (c) => {
        const m = String(c || "").match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
        if (!m) return c;
        const a = String(c).match(/rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)/);
        if (a && Number(a[4]) === 0) return "transparent";
        return (
          "#" +
          [m[1], m[2], m[3]]
            .map((n) => Number(n).toString(16).padStart(2, "0"))
            .join("")
        );
      };
      return {
        ok: true,
        tokens: {
          bg: cs.getPropertyValue("--n-bg").trim(),
          line: cs.getPropertyValue("--n-line-solid").trim(),
          label: cs.getPropertyValue("--n-label").trim(),
          accent: cs.getPropertyValue("--n-accent").trim(),
        },
        surfaces: {
          shell: rgbToHex(cs.backgroundColor),
          topBottom: rgbToHex(hex(top, "borderBottomColor")),
          leftRight: rgbToHex(hex(left, "borderRightColor")),
          rightLeft: rgbToHex(hex(right, "borderLeftColor")),
          bottomTop: rgbToHex(hex(bottom, "borderTopColor")),
          composer: composer
            ? rgbToHex(getComputedStyle(composer).borderTopColor)
            : null,
        },
        regions: {
          topbar: !!top,
          sidebar: !!left,
          files: !!right,
          bottom: !!document.querySelector(".wire-bottom-dock, .wire-bottom-bar"),
          settings: !!document.querySelector(
            ".wire-mid.is-settings, [data-live-region='settings']",
          ),
          project: !!document.querySelector(
            ".wire-mid.is-project, [data-live-region='project']",
          ),
          plugins: !!document.querySelector(
            ".wire-mid.is-plugins, [data-live-region='plugins']",
          ),
          chat: !!document.querySelector(".wire-mid.is-chat:not([hidden])"),
        },
        metaBg: rgbToHex(hex(meta, "backgroundColor")),
        metaColor: rgbToHex(hex(meta, "color")),
      };
    })()`,
  );
}

async function openPage(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#ededed",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(url);
  await evalPage(win, "document.fonts.ready.then(() => true)");
  await sleep(500);
  return win;
}

async function rec(win, steps, name, fn) {
  if (fn) await fn();
  await sleep(280);
  await shot(win, name);
  const info = await inspect(win);
  steps.push({ name, ...info });
  return info;
}

async function driveDraft(win) {
  const steps = [];
  await rec(win, steps, "draft-chat");
  const imOk = await clickLabel(win, ".wire-agent-scope-tab", "IM");
  const imInbox = await evalPage(
    win,
    `!!document.querySelector(".wire-im-inbox, .wire-agent-empty")`,
  );
  const composerBits = await evalPage(
    win,
    `({
      more: !!document.querySelector('[aria-label="更多"]'),
      attach: !!document.querySelector('[aria-label="附图"]'),
      send: !!document.querySelector(".wire-composer-send"),
    })`,
  );
  steps.push({
    name: "draft-im-composer",
    imTab: imOk,
    imInbox,
    composerBits,
  });
  await clickLabel(win, ".wire-agent-scope-tab", "系统");
  await rec(win, steps, "draft-project", () =>
    clickLabel(win, ".wire-mode-tabs button", "项目"),
  );
  await rec(win, steps, "draft-plugins", () =>
    clickLabel(win, ".wire-mode-tabs button", "插件"),
  );
  await rec(win, steps, "draft-settings", () =>
    clickLabel(win, ".wire-mode-tabs button", "设置"),
  );
  await rec(win, steps, "draft-chat-back", () =>
    clickLabel(win, ".wire-mode-tabs button", "聊天"),
  );
  await rec(win, steps, "draft-files-off", () =>
    clickLabel(win, ".wire-topbar .wire-text-btn", "文件"),
  );
  await rec(win, steps, "draft-files-on", () =>
    clickLabel(win, ".wire-topbar .wire-text-btn", "文件"),
  );
  const hasDock = await evalPage(
    win,
    `!!document.querySelector(".wire-dock-card-ear")`,
  );
  if (hasDock) {
    await rec(win, steps, "draft-dock", () =>
      evalPage(
        win,
        `(async () => {
          const ear = document.querySelector(".wire-dock-card-ear");
          if (!ear) return false;
          const r = ear.getBoundingClientRect();
          const opts = {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            pointerId: 7,
            pointerType: "mouse",
          };
          ear.dispatchEvent(new PointerEvent("pointerdown", opts));
          await new Promise((done) => setTimeout(done, 30));
          ear.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
          return true;
        })()`,
      ),
    );
  }
  await evalPage(win, `document.querySelector(".draft-resize-handle")?.focus(); true`);
  const before = await evalPage(
    win,
    `document.querySelector(".draft-resize-handle")?.getAttribute("aria-valuenow")`,
  );
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Right" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Right" });
  await sleep(80);
  const after = await evalPage(
    win,
    `document.querySelector(".draft-resize-handle")?.getAttribute("aria-valuenow")`,
  );
  steps.push({
    name: "draft-resize",
    resized: { before, after, moved: before !== after },
  });
  return steps;
}

async function driveLive(win) {
  const steps = [];
  await rec(win, steps, "live-chat");
  await rec(win, steps, "live-project", () =>
    clickLabel(win, ".wire-mode-tabs button", "项目"),
  );
  await rec(win, steps, "live-plugins", () =>
    clickLabel(win, ".wire-mode-tabs button", "插件"),
  );
  await rec(win, steps, "live-settings", () =>
    clickLabel(win, ".wire-mode-tabs button", "设置"),
  );
  await rec(win, steps, "live-chat-back", () =>
    clickLabel(win, ".wire-mode-tabs button", "聊天"),
  );
  await rec(win, steps, "live-files", () =>
    clickLabel(win, ".wire-topbar .wire-text-btn", "文件"),
  );
  const liveIm = await clickLabel(win, ".wire-agent-scope-tab", "IM");
  const liveBits = await evalPage(
    win,
    `({
      im: !!document.querySelector(".wire-im-inbox, .wire-agent-empty"),
      more: !!document.querySelector('[aria-label="更多"]'),
      attach: !!document.querySelector('[aria-label="附图"]'),
      top: !!document.querySelector(".wire-topbar"),
      left: !!document.querySelector(".wire-left"),
      mid: !!document.querySelector(".wire-mid"),
      bottom: !!document.querySelector(".wire-bottom-dock, .wire-bottom-bar"),
    })`,
  );
  steps.push({ name: "live-im-composer", imTab: liveIm, ...liveBits });
  return steps;
}

function assertPaper(info, label) {
  const fails = [];
  if (!info.ok) {
    fails.push(`${label}: ${info.reason}`);
    return fails;
  }
  if (info.tokens?.bg !== "#ededed") fails.push(`${label} --n-bg ${info.tokens?.bg}`);
  if (info.tokens?.line !== "#9b9b9b") {
    fails.push(`${label} --n-line ${info.tokens?.line}`);
  }
  if (info.tokens?.label !== "#000000") {
    fails.push(`${label} --n-label ${info.tokens?.label}`);
  }
  if (info.tokens?.accent !== "#b80c00") {
    fails.push(`${label} --n-accent ${info.tokens?.accent}`);
  }
  if (info.surfaces?.shell && info.surfaces.shell !== "#ededed") {
    fails.push(`${label} shell bg ${info.surfaces.shell}`);
  }
  if (info.metaBg === "#000000" && info.metaColor === "#000000") {
    fails.push(`${label} meta black-on-black`);
  }
  return fails;
}

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  await waitVite();
  const report = { draft: [], live: [], fails: [] };

  const draft = await openPage(`${BASE}/draft.html`);
  report.draft = await driveDraft(draft);
  for (const s of report.draft) {
    if (s.tokens) report.fails.push(...assertPaper(s, s.name));
  }
  if (!report.draft.find((s) => s.name === "draft-project")?.regions?.project) {
    report.fails.push("draft 项目 mid missing");
  }
  if (!report.draft.find((s) => s.name === "draft-plugins")?.regions?.plugins) {
    report.fails.push("draft 插件 mid missing");
  }
  if (!report.draft.find((s) => s.name === "draft-settings")?.regions?.settings) {
    report.fails.push("draft 设置 mid missing");
  }
  if (report.draft.find((s) => s.name === "draft-files-off")?.regions?.files) {
    report.fails.push("draft 文件 toggle did not hide rail");
  }
  if (!report.draft.find((s) => s.name === "draft-files-on")?.regions?.files) {
    report.fails.push("draft 文件 toggle did not show rail");
  }
  if (!report.draft.find((s) => s.name === "draft-resize")?.resized?.moved) {
    report.fails.push("draft sidebar resize did not move");
  }
  const imStep = report.draft.find((s) => s.name === "draft-im-composer");
  if (!imStep?.imTab || !imStep?.imInbox) {
    report.fails.push("draft IM inbox missing");
  }
  if (!imStep?.composerBits?.more || !imStep?.composerBits?.attach) {
    report.fails.push("draft composer more/attach missing");
  }
  if (
    report.draft.find((s) => s.name === "draft-dock") &&
    !report.draft.find((s) => s.name === "draft-dock")?.regions?.bottom
  ) {
    report.fails.push("draft bottom dock missing");
  }

  const live = await openPage(`${BASE}/`);
  report.live = await driveLive(live);
  for (const s of report.live) {
    if (s.tokens) report.fails.push(...assertPaper(s, s.name));
  }
  if (!report.live.find((s) => s.name === "live-project")?.regions?.project) {
    report.fails.push("live 项目 mid missing");
  }
  if (!report.live.find((s) => s.name === "live-settings")?.regions?.settings) {
    report.fails.push("live 设置 mid missing");
  }
  const liveIm = report.live.find((s) => s.name === "live-im-composer");
  if (!liveIm?.imTab || !liveIm?.im) {
    report.fails.push("live IM inbox missing");
  }
  if (!liveIm?.more || !liveIm?.attach) {
    report.fails.push("live composer more/attach missing");
  }
  if (!liveIm?.top || !liveIm?.left || !liveIm?.mid || !liveIm?.bottom) {
    report.fails.push("live five regions missing");
  }

  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ fails: report.fails, out: OUT }, null, 2)}\n`);
  draft.destroy();
  live.destroy();
  app.exit(report.fails.length ? 1 : 0);
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
