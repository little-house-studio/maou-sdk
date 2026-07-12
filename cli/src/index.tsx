#!/usr/bin/env node
/** Maou CLI 入口 — maou [path] --theme <name> */
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { installExitGuard } from "./hooks/useExitGuard.js";
import type { AgentCliConfig } from "./types.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

async function loadConfig(target?: string): Promise<AgentCliConfig> {
  if (!target) {
    const mod = await import("@little-house-studio/coding-agent/cli-config");
    return (mod.default ?? mod) as AgentCliConfig;
  }
  const abs = resolve(target);
  let importPath = abs;
  if (!existsSync(abs) || abs.endsWith("/")) {
    for (const n of ["cli.ts", "index.ts", "agent-cli.ts", "cli-config.ts"]) {
      const c = `${abs}/${n}`;
      if (existsSync(c)) { importPath = c; break; }
    }
    if (importPath === abs) {
      const mod = await import(target);
      return (mod.default ?? mod) as AgentCliConfig;
    }
  }
  const mod = await import(importPath);
  const cfg = (mod.default ?? mod) as AgentCliConfig;
  if (!cfg?.createAgent) { console.error(`❌ ${importPath} 缺少 createAgent`); process.exit(1); }
  return cfg;
}

const argv = process.argv.slice(2);
let target: string | undefined;
let themePath: string | undefined;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "-h" || argv[i] === "--help") {
    console.log(`Maou CLI — 终端 AI 对话（磁带复古未来主义）\n\n用法:\n  maou              默认 coding agent\n  maou <path>       加载 agent cli 配置\n  maou --theme <p>  加载主题 JSON（默认 Tau Ceti）`);
    process.exit(0);
  } else if (argv[i] === "--theme") {
    themePath = argv[++i];
  } else if (!argv[i]!.startsWith("-")) target = argv[i];
}

// pino 日志不污染 Ink stdout
process.env.NODE_ENV = "production";

// 退出安全网：crash/SIGINT/SIGTERM/uncaught 都恢复终端
installExitGuard();

// 重定向 console.log/warn 到 stderr（SDK 内部的 console.log 会撕裂 Ink 备用屏画面，
// stderr 不进 Ink 渲染，且 patchConsole:false 让 Ink 不拦截 console）
const origLog = console.log;
const origWarn = console.warn;
console.log = (...a: unknown[]) => { process.stderr.write(a.join(" ") + "\n"); };
console.warn = (...a: unknown[]) => { process.stderr.write(a.join(" ") + "\n"); };
console.error = (...a: unknown[]) => { process.stderr.write(a.join(" ") + "\n"); };

// 过滤 stdin：剥离鼠标 SGR/SS3/OSC 序列，防止 react-ink-textarea 把它们当文本插入乱码
import { createFilteredStdin } from "./input/filtered-stdin.js";
const filteredStdin = process.env.MAOU_NO_FILTER === "1" ? process.stdin : createFilteredStdin(process.stdin);

// 过滤 stdout：剥离 Ink #935 的 \e[3J（抹 scrollback），保留 \e[2J\e[H 清视口。
// 防止内容超视口时顶部 border 丢失 + 残留。对应 upstream PR #936（未合并）。
import { createFilteredStdout } from "./input/filtered-stdout.js";
const filteredStdout = process.env.MAOU_NO_FILTER === "1" ? process.stdout : createFilteredStdout(process.stdout);

loadConfig(target).then(async (config) => {
  // vram-layer：patch Output.get + fakeStdout
  const { initVramLayer, createFakeStdout, setThemeBg, scheduleFullPaint, renderWithSelection } = await import("./render/vram-layer.js");
  await initVramLayer();
  // 首屏兜底：onRender 可能在 App 的 setThemeBg effect 之前 fire，先按初始主题 bg 填好背景，
  // 避免首帧空白区显示终端默认底（透明闪烁）。
  const { TAU_CETI } = await import("./theme/tau-ceti.js");
  const { loadThemeFile } = await import("./theme/hot-reload.js");
  const initTheme = themePath ? (loadThemeFile(themePath) ?? TAU_CETI) : TAU_CETI;
  setThemeBg(initTheme.bg);
  const fakeStdout = createFakeStdout();
  // 进备用屏 + 开鼠标（真实 stdout！）+ 隐藏光标
  process.stdout.write("\x1b[?1049h\x1b[H\x1b[2J\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?25l");
  // Ink 布局完成 → 全量帧（选区绘制走 schedulePaint 脏行，避免与鼠标双刷闪烁）
  const scheduleRender = () => scheduleFullPaint();
  // 把 fakeStdout 交给尺寸单例（App 内 TerminalSizeProvider 也会再登记一次）
  const { setInkStdoutForResize, syncTerminalSize } = await import("./hooks/useTerminalSize.js");
  setInkStdoutForResize(fakeStdout);

  const { waitUntilExit } = render(<App config={config} themePath={themePath} />, {
    exitOnCtrlC: false,
    stdin: filteredStdin as NodeJS.ReadStream,
    stdout: fakeStdout as any,
    patchConsole: false,
    onRender: scheduleRender,
  });
  setTimeout(() => scheduleFullPaint(), 200);

  const onResize = () => {
    syncTerminalSize(true);
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    process.stdout.write("\x1b[2J\x1b[H");
    setTimeout(() => renderWithSelection(process.stdout.columns || cols, process.stdout.rows || rows, { selectionOnly: false }), 40);
    setTimeout(() => scheduleFullPaint(), 160);
  };
  process.stdout.on("resize", onResize);
  process.on("SIGWINCH", onResize);
  waitUntilExit().then(() => {
    process.stdout.write("\x1b[?25h\x1b[?1006l\x1b[?1003l\x1b[?1049l");
    process.exit(0);
  });
}).catch(err => {
  process.stderr.write(`❌ ${err?.message ?? err}\n`);
  process.exit(1);
});
