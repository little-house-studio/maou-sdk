#!/usr/bin/env node
/**
 * maou-web —— 启动本机 WebUI（默认 127.0.0.1:8787）
 *
 *   maou-web
 *   maou-web --port 9000
 *   MAOU_WEBUI_PORT=9000 maou-web
 */

import { createWebUiServer } from "./create-server.js";

function parseArgs(argv: string[]) {
  let port = Number(process.env.MAOU_WEBUI_PORT || 8787);
  let host = process.env.MAOU_WEBUI_HOST || "127.0.0.1";
  let projectRoot = process.env.MAOU_PROJECT_ROOT || process.cwd();
  let sandboxMode = process.env.MAOU_SANDBOX_MODE || "yolo";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--port" || a === "-p") port = Number(argv[++i] || port);
    else if (a.startsWith("--port=")) port = Number(a.slice(7));
    else if (a === "--host") host = argv[++i] || host;
    else if (a === "--cwd") projectRoot = argv[++i] || projectRoot;
    else if (a === "--sandbox") sandboxMode = argv[++i] || sandboxMode;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(`maou-web — Maou WebUI (chat + terminal)

Usage:
  maou-web [--port 8787] [--host 127.0.0.1] [--cwd PATH] [--sandbox yolo|normal|auto]

Env:
  MAOU_WEBUI_PORT  MAOU_WEBUI_HOST  MAOU_PROJECT_ROOT  MAOU_SANDBOX_MODE
`);
      process.exit(0);
    }
  }
  return { port, host, projectRoot, sandboxMode };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // WebUI 要「点开终端可键盘交互」：默认开真 PTY（管道模式 write 会失败）。
  // 可显式 MAOU_PTY_FORCE=0 关掉，与 CLI 默认管道行为对齐。
  if (process.env.MAOU_PTY_FORCE === undefined) {
    process.env.MAOU_PTY_FORCE = "1";
  }

  const server = createWebUiServer({
    port: opts.port,
    host: opts.host,
    projectRoot: opts.projectRoot,
    sandboxMode: opts.sandboxMode,
  });

  const { url } = await server.start();
  process.stdout.write(
    `[maou-web] ${url}\n` +
      `  project: ${opts.projectRoot}\n` +
      `  sandbox: ${opts.sandboxMode}\n` +
      `  pty:     MAOU_PTY_FORCE=${process.env.MAOU_PTY_FORCE}\n` +
      `  chat:    POST ${url}/api/chat\n` +
      `  terms:   GET  ${url}/api/terminals\n` +
      `  attach:  WS   ${url.replace("http", "ws")}/ws/agent-terminal?id=&agent=coding\n`,
  );

  const shutdown = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  process.stderr.write(`[maou-web] failed: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
