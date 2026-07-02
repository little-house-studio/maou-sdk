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
  // 进备用屏 + 隐藏光标
  filteredStdout.write("\x1b[?1049h\x1b[H\x1b[?25l");
  const { waitUntilExit } = render(<App config={config} themePath={themePath} />, {
    exitOnCtrlC: false,
    stdin: filteredStdin as NodeJS.ReadStream,
    stdout: filteredStdout,
    patchConsole: false,  // 不拦截 console（已重定向到 stderr），避免 SDK log 撕裂画面
  });
  waitUntilExit().then(() => {
    // 正常退出序列（exitGuard 也兜底）
    filteredStdout.write("\x1b[?25h\x1b[?1049l\x1b[?1006l\x1b[?1000l");
  });
}).catch(err => {
  process.stderr.write(`❌ ${err?.message ?? err}\n`);
  process.exit(1);
});
