#!/usr/bin/env node
/** Maou CLI 入口 — maou [path] --theme <name> */
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { setTheme, THEMES } from "./theme.js";
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
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--theme") setTheme(argv[++i]!);
  else if (argv[i] === "-h" || argv[i] === "--help") {
    console.log(`Maou CLI — 终端 AI 对话\n\n用法:\n  maou              默认 coding agent\n  maou <path>       加载 agent cli 配置\n  maou --theme <n>   主题: ${Object.keys(THEMES).join("|")}`);
    process.exit(0);
  } else if (!argv[i]!.startsWith("-")) target = argv[i];
}

// pino 日志不污染 Ink stdout
process.env.NODE_ENV = "production";

loadConfig(target).then(async (config) => {
  // 初始化 provider/model
  const ps = config.getProviders?.() ?? [];
  if (ps.length > 0) {
    const ms = config.getModels?.(ps[0]!.id) ?? [];
    if (ms.length > 0) {
      const { useStore } = await import("./state/store.js");
      useStore.getState().setProviderModel(ps[0]!.id, ms[0]!.id);
    }
  }

  process.stdout.write("\x1b[?1049h\x1b[H\x1b[?25l");
  const { waitUntilExit } = render(<App config={config} />, { exitOnCtrlC: false });
  waitUntilExit().then(() => {
    process.stdout.write("\x1b[?25h\x1b[?1049l\x1b[?1006l\x1b[?1000l");
  });
}).catch(err => { console.error(`❌ ${err?.message ?? err}`); process.exit(1); });
