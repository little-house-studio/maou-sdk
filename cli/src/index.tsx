#!/usr/bin/env node
/** Maou CLI 入口 —— 通用框架，加载任意 agent cli 配置
 *
 * 用法:
 *   maou                          → 默认 coding agent
 *   maou <path>                   → 加载指定 agent cli 文件/目录
 *   maou --theme <name>           → 指定主题
 *   maou -h / --help              → 帮助
 *
 * <path> 可以是:
 *   - .ts/.js/.tsx 文件 → 直接 import，取 default: AgentCliConfig
 *   - 目录 → 尝试 <dir>/cli.ts → <dir>/index.ts → <dir>/agent-cli.ts
 */
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { setTheme, THEMES } from "./theme.js";
import type { AgentCliConfig } from "./types.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// 默认 coding-agent 的 cli 配置路径
const DEFAULT_CONFIG_PATH = "@little-house-studio/coding-agent/cli-config";

async function loadConfig(target?: string): Promise<AgentCliConfig> {
  if (!target) {
    // 默认：加载 coding-agent 的 cli-config
    const mod = await import(DEFAULT_CONFIG_PATH);
    return (mod.default ?? mod) as AgentCliConfig;
  }

  const abs = resolve(target);
  let importPath: string;

  if (existsSync(abs) && !abs.endsWith("/")) {
    // 是文件
    importPath = abs;
  } else {
    // 是目录，尝试几个常见文件名
    for (const name of ["cli.ts", "index.ts", "agent-cli.ts", "cli-config.ts"]) {
      const candidate = `${abs}/${name}`;
      if (existsSync(candidate)) { importPath = candidate; break; }
    }
    if (!importPath!) {
      // 可能是包名（node_modules 里的 agent 包）
      try {
        const mod = await import(target);
        return (mod.default ?? mod) as AgentCliConfig;
      } catch {
        console.error(`❌ 找不到 agent cli 配置: ${target}\n尝试: ${abs}/{cli,index,agent-cli}.ts 或包名`);
        process.exit(1);
      }
    }
  }

  const mod = await import(importPath);
  const config = (mod.default ?? mod) as AgentCliConfig;
  if (!config || typeof config.createAgent !== "function") {
    console.error(`❌ ${importPath} 没有 export default AgentCliConfig（需含 createAgent）`);
    process.exit(1);
  }
  return config;
}

// CLI 参数解析
const argv = process.argv.slice(2);
let targetPath: string | undefined;
let themeName: string | undefined;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === "--theme") { themeName = argv[++i]!; continue; }
  if (arg === "-h" || arg === "--help") {
    const themeNames = Object.keys(THEMES).join("|");
    console.log(`Maou CLI — 通用 agent 测试界面

用法:
  maou                    默认 coding agent
  maou <path>             加载 agent cli 文件/目录/包名
  maou --theme <name>     主题: ${themeNames}

<path>:
  文件: /path/to/my-agent/cli.ts
  目录: /path/to/my-agent/（自动找 cli.ts/index.ts/agent-cli.ts）
  包名: my-agent（node_modules 里）

agent cli 文件需 export default AgentCliConfig（含 createAgent/getPreset）。
agent 绑定到当前目录（cwd）。`);
    process.exit(0);
  }
  if (arg === "--test") { continue; }
  // 非选项参数 = agent cli 路径
  if (!arg.startsWith("-")) { targetPath = arg; }
}

if (themeName) setTheme(themeName);

// 异步加载 config 后启动
loadConfig(targetPath).then((config) => {
  // 进入备用屏（全屏 TUI）
  process.stdout.write("\x1b[?1049h\x1b[H");
  process.stdout.write("\x1b[?25l");
  const { waitUntilExit } = render(<App config={config} />, { exitOnCtrlC: false });
  waitUntilExit().then(() => {
    process.stdout.write("\x1b[?25h");
    process.stdout.write("\x1b[?1049l");
    process.stdout.write("\x1b[?1006l\x1b[?1000l");
  });
}).catch((err) => {
  console.error(`❌ 加载 agent 配置失败: ${err?.message ?? err}`);
  process.exit(1);
});
