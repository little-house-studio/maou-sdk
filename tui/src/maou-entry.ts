#!/usr/bin/env node
/**
 * maou 通用启动器入口 —— argv 解析 + runTuiFromPath。
 *
 * 用法：
 *   maou <agent-path-or-package>   加载指定 agent 模板（测试主用法）
 *   maou <agent-path> --cwd <dir>  指定工作目录
 *   maou --help
 *
 * <agent-path-or-package> 支持：
 *   - 包名/子路径：@little-house-studio/coding-agent/cli-config
 *   - 目录：./agents/foo（自动找 cli.ts/index.ts/cli-config.ts）
 *   - 文件：./foo/cli-config.ts
 *
 * 本文件由 bin/maou.mjs 通过 `node --import preload.mjs` 拉起，
 * 因此可用 TS import + Pi TUI 组件。
 */

import { runTuiFromPath } from "./index.js";

const argv = process.argv.slice(2);
let target: string | undefined;
let cwd: string | undefined;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "-h" || a === "--help") {
    process.stdout.write(
      `MAOU — 通用 agent 终端启动器（磁带复古未来主义，基于 Pi TUI）\n\n` +
      `用法:\n` +
      `  maou <agent>              加载指定 agent 模板启动 TUI\n` +
      `  maou <agent> --cwd <dir>  指定 agent 工作目录\n\n` +
      `<agent> 支持:\n` +
      `  包名/子路径  @little-house-studio/coding-agent/cli-config\n` +
      `  目录         ./agents/foo（自动找 cli.ts/index.ts/cli-config.ts）\n` +
      `  文件         ./foo/cli-config.ts\n\n` +
      `快捷键:\n` +
      `  Enter          发送消息\n` +
      `  Alt+Enter      换行\n` +
      `  Ctrl+C         中断运行 / 退出\n` +
      `  /new           新会话\n` +
      `  /quit /exit    退出\n`,
    );
    process.exit(0);
  } else if (a === "--cwd" && argv[i + 1]) {
    cwd = argv[i + 1]!;
    i++;
  } else if (!a.startsWith("-")) {
    target = a;
  }
}

if (!target) {
  process.stderr.write(
    `MAOU — 通用 agent 终端启动器\n\n` +
    `用法: maou <agent>\n` +
    `  maou @little-house-studio/coding-agent/cli-config\n` +
    `  maou ./agents/foo\n` +
    `  maou <agent> --cwd <dir>\n\n` +
    `运行 maou --help 查看完整说明。\n`
  );
  process.exit(1);
}

await runTuiFromPath(target, cwd ? { cwd } : undefined);
