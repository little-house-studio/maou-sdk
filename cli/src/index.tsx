#!/usr/bin/env node
/** Maou CLI 入口 —— 全屏挂载 <App> */
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { setTheme } from "./theme.js";

// CLI 参数
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--theme") setTheme(argv[++i]!);
  if (argv[i] === "-h" || argv[i] === "--help") {
    console.log("Maou CLI — RPG 风终端 AI 对话\n用法: maou [--theme vampire|cyber]\n配置: ~/.maou/llm-config.json（或 MAOU_LLM_CONFIG）");
    process.exit(0);
  }
}

// 进入备用屏（全屏 TUI）
process.stdout.write("\x1b[?1049h\x1b[H");
const { waitUntilExit } = render(<App />, { exitOnCtrlC: false });
waitUntilExit().then(() => {
  process.stdout.write("\x1b[?1049l"); // 还原主屏
  process.stdout.write("\x1b[?1006l\x1b[?1000l"); // 关鼠标
});
