/**
 * input-mouse-demo.mjs —— 输入框鼠标端到端功能测试。
 *
 * 测试：
 *  1. 点击移光标：点文字中间 → 软光标飞到点击位置
 *  2. 框选删除：拖选一段 → 退格 → 文本少掉选中部分
 *  3. 点击行尾/空格：光标定位正确
 *  4. 起点决定模式：起点在对话区拖进输入框 → 走 vram 复制（OSC52），不清输入框文字
 *
 * 跑法：cd cli && node scripts/input-mouse-demo.mjs
 */
import { spawn } from "node:child_process";
import xtermNs from "@xterm/headless";
const { Terminal } = xtermNs;

const NODE = "/Users/mac/.nvm/versions/node/v24.13.0/bin/node";
const CLI = "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js";
const CWD = "/Users/mac/Downloads/coding测试";

// OSC52 拦截（验证 vram 复制模式）
function createOsc52Trap() {
  let buf = "";
  const captured = [];
  const RE = /\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/g;
  return {
    feed(chunk) {
      buf += chunk;
      let m;
      while ((m = RE.exec(buf)) !== null) {
        try { captured.push(Buffer.from(m[1], "base64").toString("utf-8")); } catch {}
      }
      buf = buf.slice(Math.max(0, buf.lastIndexOf("\x1b")));
      RE.lastIndex = 0;
    },
    captured,
  };
}

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
    env: { ...process.env, TERM_PROGRAM: "iTerm.app", FORCE_COLOR: "1", COLORTERM: "truecolor" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let dead = false;
  child.stdout.on("data", (buf) => { const s = buf.toString("utf-8"); trap.feed(s); term.write(s); });
  child.stderr.on("data", (buf) => process.stderr.write("[cli stderr] " + buf.toString("utf-8")));
  child.on("exit", () => { dead = true; });
  const api = {
    write: (s) => { if (!dead) child.stdin.write(s); },
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    line: (row) => { const l = term.buffer.active.getLine(row); return l ? l.translateToString(true) : ""; },
    /** 找软光标（反色块）位置 */
    findCursor: () => {
      for (let r = 0; r < rows; r++) {
        const l = term.buffer.active.getLine(r);
        if (!l) continue;
        for (let c = 0; c < cols; c++) {
          const cell = l.getCell(c);
          if (cell && cell.isInverse?.()) return { r, c, ch: cell.getChars() };
        }
      }
      return null;
    },
    copied: () => trap.captured.slice(),
    mouseDown: (col, row, b = 0) => api.write(`\x1b[<${b};${col};${row}M`),
    mouseUp: (col, row, b = 0) => api.write(`\x1b[<${b};${col};${row}m`),
    mouseDrag: (col, row) => api.write(`\x1b[<32;${col};${row}M`),
    click: async (col, row) => {
      api.mouseDown(col, row); await api.wait(80);
      api.mouseUp(col, row); await api.wait(350);
    },
    drag: async (fromCol, row, toCol) => {
      api.mouseDown(fromCol, row); await api.wait(40);
      const step = toCol >= fromCol ? 1 : -1;
      for (let c = fromCol + step; (step > 0 ? c <= toCol : c >= toCol); c += step) {
        api.mouseDrag(c, row); await api.wait(12);
      }
      api.mouseUp(toCol, row); await api.wait(350);
    },
    quit: async () => { try { api.write("\x03"); } catch {} await api.wait(200); try { child.kill("SIGKILL"); } catch {} },
  };
  return api;
}

const log = (...a) => process.stderr.write(a.join(" ") + "\n");

async function main() {
  let pass = 0, fail = 0;
  const ok = (name, cond, extra = "") => {
    log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
    cond ? pass++ : fail++;
  };

  // ── Case 1: 点击移光标 ──
  {
    const t = spawnCli();
    await t.wait(1500);
    t.write("你好世界abc测试");
    await t.wait(500);
    // 文字在 xterm row29，vram row30（headless 偏移）。点击喂 vram 坐标 row30。
    // 文字从 col5 起：你(5-6)好(7-8)世(9-10)界(11-12)a(13)...
    // 点 col 9（"世"起点）→ 光标该到"世"前
    await t.click(9, 30);
    const cur = t.findCursor();
    // 光标反色块应在"世"位置（col 9-10 附近）
    ok("点击移光标到「世」", cur && cur.r === 29 && cur.c >= 8 && cur.c <= 10,
       `cur=${JSON.stringify(cur)}`);
    await t.quit();
  }

  // ── Case 2: 框选删除 ──
  {
    const t = spawnCli();
    await t.wait(1500);
    t.write("你好世界abc测试");
    await t.wait(500);
    // 拖选 "世界ab"（col 9→14）：世(9-10)界(11-12)a(13)b(14)
    await t.drag(9, 30, 14, 30);
    // 退格删除
    t.write("\x7f");
    await t.wait(400);
    const line = t.line(29);
    // 应剩 "你好c测试"
    ok("框选删除「世界ab」", line.includes("你好c测试") && !line.includes("世界ab"),
       `line=${JSON.stringify(line)}`);
    await t.quit();
  }

  // ── Case 3: 点击行尾 ──
  {
    const t = spawnCli();
    await t.wait(1500);
    t.write("abc");
    await t.wait(500);
    // 点 col 20（远超文字末尾 col7）→ 光标到行末
    await t.click(20, 30);
    const cur = t.findCursor();
    ok("点击行尾光标到末尾", cur && cur.r === 29 && cur.c >= 7,
       `cur=${JSON.stringify(cur)}`);
    await t.quit();
  }

  // ── Case 4: 起点在对话区 → vram 复制模式 ──
  {
    const t = spawnCli();
    await t.wait(1500);
    t.write("你好世界");
    await t.wait(500);
    // 从对话区 row15 起点拖到输入框 row30（跨进输入框，但起点在外）
    t.mouseDown(10, 15); await t.wait(40);
    for (let r = 16; r <= 30; r++) { t.mouseDrag(10, r); await t.wait(10); }
    t.mouseUp(10, 30); await t.wait(400);
    const copied = t.copied();
    const line = t.line(29);
    // 走 vram 复制：OSC52 有内容，输入框文字未被删
    ok("起点在外→vram复制模式(有OSC52)", copied.length > 0, `copied=${JSON.stringify(copied)}`);
    ok("起点在外→输入框文字未删", line.includes("你好世界"), `line=${JSON.stringify(line)}`);
    await t.quit();
  }

  log(`\n${pass} pass, ${fail} fail / ${pass + fail} total`);
  await new Promise(r => setTimeout(r, 200));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { process.stderr.write("ERR: " + (e?.stack || e) + "\n"); process.exit(1); });
