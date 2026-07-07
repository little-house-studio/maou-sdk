/**
 * Claude Code 体感 demo —— 临时切换方案：平时 ?1003 全追踪，拖拽时关协议让终端原生选字。
 *
 * 机制：
 * - 平时开 ?1003?1006：收 hover/click/wheel
 *   - hover 按钮 → 反色高亮
 *   - 点击按钮 → 状态反馈
 *   - 滚轮 → 滚动（demo 静态，略）
 * - 检测到拖拽（按下+移动超阈值）→ 发 ?1003l?1000l 全关
 *   - 终端接管：自己画原生蓝底选区（和你平时选字一样）
 *   - 松手时终端原生处理（选区保留，Cmd+C 复制）
 * - 松手（release 事件）→ 收到后重新开 ?1003?1006 恢复 hover/点击
 *   - 若关协议后收不到 release，用"任意键恢复"兜底
 *
 * 跑：node mouse-demo/cc-feel.js
 * Ctrl+C 退出。
 *
 * 对比 Claude Code 体感：
 * 1. 拖拽文字 → 蓝底选区（原生，非程序自画）
 * 2. 松手 → 选区保留，Cmd+C 能复制
 * 3. 点击按钮 → 有响应
 * 4. hover 按钮 → 高亮
 */
const ESC = "\x1b";
const enterAlt = `${ESC}[?1049h`;
const exitAlt = `${ESC}[?1049l`;
const hideCursor = `${ESC}[?25l`;
const showCursor = `${ESC}[?25h`;
const mouse1003On = `${ESC}[?1003h${ESC}[?1006h`;
const mouseAllOff = `${ESC}[?1006l${ESC}[?1003l${ESC}[?1000l`;

const BUTTONS = [
  { label: "[选项 A]", col: 1, action: "A" },
  { label: "[选项 B]", col: 14, action: "B" },
  { label: "[选项 C]", col: 27, action: "C" },
];
const TEXT_LINES = [
  "这是第一行对话内容，hello world 你好世界。",
  "第二行：The quick brown fox jumps over the lazy dog.",
  "第三行：拖拽选我试试，松手后按 Cmd+C 复制。",
  "第四行：混合中文 abc 123 emoji 😎🎉 测试。",
  "第五行：这是 Claude Code 体感 demo，选区应蓝底。",
  "第六行：选完后点按钮看 hover 高亮。",
];

let mode = "track"; // track | released
let dragArmed = false;
let dragStart = null;
let hoverBtn = -1;
let lastFeedback = "拖拽文字选字（蓝底原生），点按钮看高亮";

function render() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write(`${ESC}[1;1HClaude Code 体感 demo（Ctrl+C 退出）`);
  // 行2：按钮（hover 反色）
  let btnLine = "";
  for (let i = 0; i < BUTTONS.length; i++) {
    const b = BUTTONS[i];
    while (btnLine.length < b.col) btnLine += " ";
    if (hoverBtn === i) btnLine += `${ESC}[7m${b.label}${ESC}[0m`;
    else btnLine += b.label;
  }
  process.stdout.write(`${ESC}[2;1H${btnLine}`);
  // 行3-8：文字
  let row = 3;
  for (const line of TEXT_LINES) {
    process.stdout.write(`${ESC}[${row};1H${line}`);
    row++;
  }
  // 状态行
  process.stdout.write(`${ESC}[${row + 1};1H模式: ${mode} | ${lastFeedback}`);
}

process.stdin.setRawMode(true);
process.stdin.resume();
// 进备用屏 + 定位 (1,1) + 清屏 + 隐藏光标 + 开 ?1003 全追踪
// 固定从终端最左上角开始，坐标无需校准
const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;
process.stdout.write(`${ESC}[?1049h${ESC}[H${ESC}[2J${ESC}[?25h${mouse1003On}`);
render();
// 显示终端大小（确认识别）
process.stdout.write(`${ESC}[${rows};1H终端: ${cols}x${rows} | 从 (1,1) 起算，坐标无需校准`);

let pending = "";
process.stdin.on("data", (chunk) => {
  let s = pending + chunk.toString("latin1");
  if (s.includes("\x03")) { cleanup(); process.exit(0); }
  // released 模式下，任意键恢复 ?1003（兜底，若 release 没收到）
  if (mode === "released" && (s.includes(" ") || s.includes("\r"))) {
    mode = "track";
    hoverBtn = -1;
    process.stdout.write(mouse1003On);
    lastFeedback = "已恢复鼠标模式（手动）";
    render();
    s = s.replace(/[ \r]/g, "");
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
      // 左键按下
      dragArmed = true;
      dragStart = { col: c, row: r };
    } else if (type === "M" && isMotion && mode === "track") {
      if (dragArmed && dragStart) {
        const dc = c - dragStart.col, dr = r - dragStart.row;
        if (dc * dc + dr * dr > 2) {
          // 检测到拖拽 → 关协议让终端接管原生选区
          mode = "released";
          hoverBtn = -1;
          process.stdout.write(mouseAllOff);
          lastFeedback = "已切到选字模式，松手后自动恢复";
          render();
        }
      } else {
        // hover（无按键 motion）
        let newHover = -1;
        if (r === 2) {
          for (let i = 0; i < BUTTONS.length; i++) {
            const bb = BUTTONS[i];
            if (c >= bb.col && c < bb.col + bb.label.length) { newHover = i; break; }
          }
        }
        if (newHover !== hoverBtn) {
          hoverBtn = newHover;
          render();
        }
      }
    } else if (type === "m") {
      // 释放
      if (dragArmed && dragStart && mode === "track") {
        // 短按：点击按钮
        if (dragStart.row === 2) {
          for (let i = 0; i < BUTTONS.length; i++) {
            const bb = BUTTONS[i];
            if (dragStart.col >= bb.col && dragStart.col < bb.col + bb.label.length) {
              lastFeedback = `点击了 ${bb.action}`;
              render();
            }
          }
        }
      }
      dragArmed = false; dragStart = null;
      if (mode === "released") {
        // 关协议后收到 release → 恢复 ?1003
        mode = "track";
        process.stdout.write(mouse1003On);
        lastFeedback = "松手，已恢复鼠标模式";
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
