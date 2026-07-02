/**
 * pty-driver.mjs —— 可控模拟终端测试工具（node-pty + 重试）。
 *
 * 能力：spawn CLI（带重试）、resize 窗口、write 键盘/SGR 鼠标序列、
 *       onData 收带 ANSI 输出、snapshot 读当前屏（脱 ANSI 或含 ANSI）。
 *
 * 用法：
 *   const t = await spawnCli({ cols, rows, cwd, env });
 *   t.write("hello"); t.resize(120, 40); t.mouseClick(col, row);
 *   const screen = t.snapshot();  // 脱 ANSI 的当前屏
 *   await t.wait(300);
 *   t.quit();
 */

import pty from "node-pty";

const NODE = "/Users/mac/.nvm/versions/node/v24.13.0/bin/node";
const CLI = "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js";

const STRIP = /\x1b\[[0-9;?]*[a-zA-Z~<]|\x1b[()][AB0-2]|\r/g;
const stripAnsi = (s) => s.replace(STRIP, "");

/** spawn CLI，失败重试最多 n 次 */
export async function spawnCli({ cols = 100, rows = 32, cwd = "/Users/mac/Downloads/coding测试", env = {}, retries = 5 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const term = pty.spawn("/usr/bin/env", ["node", CLI], {
        name: "xterm-256color",
        cols, rows, cwd,
        env: { ...process.env, FORCE_COLOR: "1", COLORTERM: "truecolor", ...env },
      });
      return wrap(term);
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 200)); }
  }
  throw new Error(`spawnCli failed after ${retries} retries: ${lastErr?.message}`);
}

function wrap(term) {
  let all = "";
  const onData = (d) => { all += d; };
  term.onData(onData);

  const api = {
    term,
    write: (s) => term.write(s),
    resize: (cols, rows) => term.resize(cols, rows),
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    /** 全量输出（脱 ANSI） */
    text: () => stripAnsi(all),
    /** 全量输出（含 ANSI，用于颜色断言） */
    raw: () => all,
    /** 末尾 N 字（脱 ANSI） */
    tail: (n = 600) => stripAnsi(all).slice(-n),
    /** 清空已读缓冲（只看后续新输出） */
    reset: () => { all = ""; },
    /** 当前屏的行数组（脱 ANSI，按 \n 切） */
    lines: () => stripAnsi(all).replace(/\r/g, "").split("\n"),
    /** 找含关键字的行 */
    grep: (re) => stripAnsi(all).split("\n").filter(l => re.test(l)),

    // ── 鼠标 SGR-1006 序列构造 ──
    /** 鼠标按下 button=0(左) col/row 1-based */
    mouseDown: (col, row, button = 0) => term.write(`\x1b[<${button};${col};${row}M`),
    /** 鼠标释放 */
    mouseUp: (col, row, button = 0) => term.write(`\x1b[<${button};${col};${row}m`),
    /** 鼠标拖动（button=32 表示拖动） */
    mouseDrag: (col, row) => term.write(`\x1b[<32;${col};${row}M`),
    /** 滚轮向上（button=64） */
    wheelUp: (col, row) => term.write(`\x1b[<64;${col};${row}M`),
    /** 滚轮向下（button=65） */
    wheelDown: (col, row) => term.write(`\x1b[<65;${col};${row}M`),
    /** 完整点击：down→up */
    click: async (col, row, button = 0) => {
      term.write(`\x1b[<${button};${col};${row}M`);
      await new Promise(r => setTimeout(r, 50));
      term.write(`\x1b[<${button};${col};${row}m`);
    },
    /** 拖选：down→drag*→up */
    drag: async (fromCol, fromRow, toCol, toRow) => {
      term.write(`\x1b[<0;${fromCol};${fromRow}M`);
      await new Promise(r => setTimeout(r, 30));
      for (let c = fromCol + 1; c <= toCol; c++) {
        term.write(`\x1b[<32;${c};${fromRow}M`);
        await new Promise(r => setTimeout(r, 10));
      }
      term.write(`\x1b[<0;${toCol};${toRow}m`);
    },

    /** 退出 */
    quit: async () => {
      try { term.write("\x03"); } catch {}
      await new Promise(r => setTimeout(r, 200));
      try { term.kill(); } catch {}
    },
  };
  return api;
}
