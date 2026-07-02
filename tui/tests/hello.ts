/**
 * Hello World —— 用 Pi TUI 包验证差分渲染。
 * 显示文字 + 实时 spinner（验证 BSU 不闪），按 q 退出。
 */

import { TUI, Text, Box, ProcessTerminal } from "@oh-my-pi/pi-tui";
import type { Component, Focusable } from "@oh-my-pi/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal, false);

// 标题（颜色内联在文本里；Pi Text 第二参数是 paddingX 不是颜色）
const title = new Text("\x1b[38;2;255;138;61m▌ MAOU TUI\x1b[0m");
const subtitle = new Text("\x1b[38;2;107;99;88m// Pi 差分渲染 + BSU 就绪\x1b[0m");

// spinner 组件（每 100ms 变化，验证差分渲染只刷变化行 + BSU 不闪）
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
class Spinner implements Component, Focusable {
  focused = false;
  private frame = 0;
  constructor() {
    setInterval(() => { this.frame++; tui.requestRender(); }, 100);
  }
  render(_width: number): string[] {
    return [`\x1b[38;2;38;198;218m${SPIN[this.frame % SPIN.length]}\x1b[0m \x1b[38;2;215;207;196m差分渲染运行中（观察不闪）\x1b[0m`];
  }
  invalidate(): void {}
  handleInput(data: string): void {
    if (data === "q" || data === "\x03") { tui.stop(); process.exit(0); }
  }
}

const hint = new Text("\x1b[38;2;107;99;88m按 q 退出\x1b[0m");

// Box 构造签名是 (paddingX?, paddingY?, bgFn?, border?)，不是 {children}
const box = new Box(1, 0);
box.addChild(title);
box.addChild(subtitle);
box.addChild(new Spinner());
box.addChild(hint);
tui.addChild(box);
tui.setFocus(new Spinner());
tui.start();

// 自动退出（测试用）：3 秒后 dump 屏幕到 stderr 并退出
setTimeout(() => {
  process.stderr.write("[hello] 3s 自动退出\n");
  tui.stop();
  process.exit(0);
}, 3000);
