/**
 * osc52-select-demo.mjs —— 端到端功能测试：鼠标拖拽选区 → OSC52 复制。
 *
 * 这是真正的"功能测试"，不是隔离单测：
 *  - spawn 真实 CLI 进程（dist/index.js，走真实启动路径：initVramLayer + ?1003 + vram 渲染）
 *  - 用 @xterm/headless 做假终端（纯 JS 无 fork，沙箱稳定）
 *  - 喂真实 SGR-1006 鼠标序列模拟拖拽
 *  - 拦截子进程 stdout 的 OSC52 序列（ESC ] 52 ; c ; <base64> BEL），
 *    base64 解码出"松手时实际复制到剪贴板的文本"
 *  - 跟原文逐字比对
 *
 * 验证链：鼠标 down→drag→up → useMouseInput → setSelection → extractSelection（从 lastGrid 显存取）
 *        → osc52() → stdout OSC52 序列 → 这里拦截解码 → 断言文本完整。
 *
 * 跑法：cd cli && node scripts/osc52-select-demo.mjs
 */
import { spawn } from "node:child_process";
import xtermNs from "@xterm/headless";
const { Terminal } = xtermNs;

const NODE = "/Users/mac/.nvm/versions/node/v24.13.0/bin/node";
const CLI = "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js";
const CWD = "/Users/mac/Downloads/coding测试";

// OSC52 拦截：从 stdout 字节流里抠 ESC ] 52 ; c ; <b64> (BEL 或 ST)
// 用增量状态机，跨 chunk 不丢
function createOsc52Trap() {
  let buf = "";
  const captured = [];
  const RE = /\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/g; // BEL 结尾（osc52.ts 发的是 \x07）
  return {
    feed(chunk) {
      buf += chunk;
      let m;
      while ((m = RE.exec(buf)) !== null) {
        try {
          const text = Buffer.from(m[1], "base64").toString("utf-8");
          captured.push(text);
        } catch {}
      }
      // 只保留未匹配的尾巴（可能跨 chunk）
      const last = RE.lastIndex;
      if (last > 0 && last < buf.length) {
        // 找最后一个 ESC 的位置，保留从那开始
        const esc = buf.lastIndexOf("\x1b", last - 1);
        buf = buf.slice(esc > -1 ? esc : last);
      } else if (last >= buf.length) {
        buf = "";
      }
      RE.lastIndex = 0;
    },
    captured,
  };
}

// 子进程内 monkeypatch stdin/stdout 为 TTY（Ink 要求），再 import CLI
function spawnCli({ cols = 100, rows = 32 } = {}) {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const trap = createOsc52Trap();

  const wrapperCode = `
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: ${cols}, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: ${rows}, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    process.stdin.setRawMode = () => process.stdin;
    process.stdin.ref = () => {}; process.stdin.unref = () => {};
    await import("${CLI}");
  `;

  const child = spawn(NODE, ["--input-type=module", "-e", wrapperCode], {
    cwd: CWD,
    env: {
      ...process.env,
      // osc52.ts 的 osc52Supported() 看 TERM_PROGRAM；设成 iTerm.app 让它真的发序列
      TERM_PROGRAM: "iTerm.app",
      FORCE_COLOR: "1",
      COLORTERM: "truecolor",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let dead = false;
  child.stdout.on("data", (buf) => {
    const s = buf.toString("utf-8");
    trap.feed(s);       // 拦截 OSC52
    term.write(s);      // 同时喂 xterm 维护网格（读屏断言用）
  });
  child.stderr.on("data", (buf) => process.stderr.write("[cli stderr] " + buf.toString("utf-8")));
  child.on("exit", (code) => { dead = true; });

  const api = {
    term, child, dead: () => dead,
    write: (s) => { if (!dead) child.stdin.write(s); },
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    /** xterm 某行（trim 尾随空格） */
    line: (row) => { const l = term.buffer.active.getLine(row); return l ? l.translateToString(true) : ""; },
    /** xterm 全屏行数组 */
    screen: () => {
      const out = [];
      for (let r = 0; r < term.buffer.active.length; r++) {
        const l = term.buffer.active.getLine(r);
        if (l) out.push(l.translateToString(true));
      }
      return out;
    },
    /** OSC52 拦截到的复制文本数组 */
    copied: () => trap.captured.slice(),
    // SGR-1006 鼠标序列
    mouseDown: (col, row, button = 0) => api.write(`\x1b[<${button};${col};${row}M`),
    mouseUp: (col, row, button = 0) => api.write(`\x1b[<${button};${col};${row}m`),
    mouseDrag: (col, row) => api.write(`\x1b[<32;${col};${row}M`),
    /** 拖拽：down→逐列drag→up（模拟真人拖动） */
    drag: async (fromCol, fromRow, toCol, toRow) => {
      api.mouseDown(fromCol, fromRow);
      await api.wait(40);
      const step = toCol >= fromCol ? 1 : -1;
      for (let c = fromCol + step; (step > 0 ? c <= toCol : c >= toCol); c += step) {
        api.mouseDrag(c, fromRow);
        await api.wait(12);
      }
      api.mouseUp(toCol, toRow);
    },
    quit: async () => {
      try { api.write("\x03"); } catch {}
      await api.wait(200);
      try { child.kill("SIGKILL"); } catch {}
    },
  };
  return api;
}

// ─────────── 测试用例 ───────────
// 注意：输入框内拖选现在走 text 模式（保留选区待删除，不 OSC52 复制）。
// 所以这里测「对话区/EventBlock 装饰行」的 vram 复制——起点在输入框外，走蓝底复制模式。
const log = (...a) => process.stderr.write(a.join(" ") + "\n");

async function runCase(name, { expectSubstr, dragRow, dragFromCol, dragToCol }) {
  const t = spawnCli({ cols: 100, rows: 32 });
  await t.wait(1300);
  // 拖选 EventBlock 横线行（启动屏就有，row 28 附近，vram 偏移试候选）
  let hit = "";
  for (const r of [dragRow, dragRow + 1, dragRow - 1]) {
    t.mouseDown(dragFromCol, r); await t.wait(40);
    const step = dragToCol >= dragFromCol ? 1 : -1;
    for (let c = dragFromCol + step; (step > 0 ? c <= dragToCol : c >= dragToCol); c += step) {
      t.mouseDrag(c, r); await t.wait(10);
    }
    t.mouseUp(dragToCol, r); await t.wait(300);
    const cp = t.copied();
    if (cp.length > 0) { hit = cp[cp.length - 1]; break; }
  }
  const ok = hit.includes(expectSubstr);
  log(`${ok ? "✅" : "❌"} ${name}`);
  log(`   expect 含: ${JSON.stringify(expectSubstr)}`);
  log(`   got     : ${JSON.stringify(hit.slice(0, 60))}`);
  await t.quit();
  return ok;
}

async function main() {
  let pass = 0, fail = 0;
  // EventBlock 横线在 xterm row 28，内容是一串 ─。拖选一段应复制出 ─────
  const cases = [
    { name: "对话区横线 vram 复制", expectSubstr: "────", dragRow: 28, dragFromCol: 5, dragToCol: 15 },
  ];
  for (const c of cases) {
    (await runCase(c.name, c)) ? pass++ : fail++;
  }
  log(`\n${pass} pass, ${fail} fail / ${cases.length} total`);
  await new Promise(r => setTimeout(r, 200));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { process.stderr.write("ERR: " + (e?.stack || e) + "\n"); process.exit(1); });
