/**
 * 临时切换方案 demo —— ?1003 检测拖拽，关协议让终端原生选字，松手恢复。
 *
 * 流程：
 * 1. 开 ?1003?1006 全追踪
 * 2. 左键按下 → 记起点
 * 3. 按住移动（drag 事件）→ 检测到移动超阈值 → 发 ?1003l?1000l 全关
 *    此时终端应接管：自己画原生选区（反色），松手时终端原生处理
 * 4. 关键测试：关协议后，松手时程序能否收到 release（?1000l 后终端不发事件）
 *    - 若收不到 → 用定时器轮询？或松手靠终端原生（程序不恢复 ?1003）
 *    - 简化：关协议后程序不再处理，让用户选完按任意键恢复 ?1003
 *
 * 跑：node mouse-demo/toggle-test.js
 * Ctrl+C 退出。
 *
 * 测试：
 * 1. 拖拽文字 → 关协议后终端是否画出原生选区（反色）？
 * 2. 松手后选区还在吗？Cmd+C 能复制吗？
 * 3. 按空格键恢复 ?1003，再试点击/hover
 */
const ESC = "\x1b";
const enterAlt = `${ESC}[?1049h`;
const exitAlt = `${ESC}[?1049l`;
const hideCursor = `${ESC}[?25l`;
const showCursor = `${ESC}[?25h`;
const mouse1003On = `${ESC}[?1003h${ESC}[?1006h`;
const mouseAllOff = `${ESC}[?1006l${ESC}[?1003l${ESC}[?1000l`;

const TEXT_LINES = [
  "这是第一行可选择的文字 hello world 你好世界。",
  "第二行 The quick brown fox jumps over the lazy dog.",
  "第三行 拖拽选我试试 松手后按 Cmd+C 复制。",
  "第四行 混合中文 abc 123 emoji 😎🎉 测试宽字符。",
  "第五行 选完后按空格键恢复鼠标事件模式。",
];

let mode = "track"; // track | released
let dragArmed = false;
let dragStart = null;

function render() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write(`${ESC}[1;1H临时切换方案 demo（Ctrl+C 退出）`);
  let row = 3;
  for (const line of TEXT_LINES) {
    process.stdout.write(`${ESC}[${row};1H${line}`);
    row++;
  }
  process.stdout.write(`${ESC}[${row + 1};1H模式: ${mode} | 拖拽文字选字，选完按空格恢复鼠标`);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(enterAlt + hideCursor + mouse1003On);
render();

let pending = "";
process.stdin.on("data", (chunk) => {
  let s = pending + chunk.toString("latin1");
  if (s.includes("\x03")) { cleanup(); process.exit(0); }
  // 空格键恢复 ?1003
  if (mode === "released" && s.includes(" ")) {
    mode = "track";
    process.stdout.write(mouse1003On);
    render();
    s = s.replace(/ /g, "");
  }
  // 解析 SGR 鼠标
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    const b = parseInt(m[1], 10);
    const c = parseInt(m[2], 10);
    const r = parseInt(m[3], 10);
    const type = m[4];
    const button = b & 3;
    const isMotion = !!(b & 32);
    if (type === "M" && button === 0 && !isMotion) {
      dragArmed = true;
      dragStart = { col: c, row: r };
    } else if (type === "M" && isMotion && dragArmed && dragStart) {
      const dc = c - dragStart.col, dr = r - dragStart.row;
      if (dc * dc + dr * dr > 2 && mode === "track") {
        // 检测到拖拽 → 关协议让终端接管
        mode = "released";
        process.stdout.write(mouseAllOff);
        render();
      }
    } else if (type === "m") {
      // 释放
      dragArmed = false; dragStart = null;
      if (mode === "released") {
        // 关协议后收到了 release！恢复 ?1003
        mode = "track";
        process.stdout.write(mouse1003On);
        render();
      }
    }
    last = re.lastIndex;
  }
  pending = s.slice(last);
});

function cleanup() {
  process.stdout.write(mouseAllOff + showCursor + exitAlt);
  try { process.stdin.setRawMode(false); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", () => { try { cleanup(); } catch {} });
