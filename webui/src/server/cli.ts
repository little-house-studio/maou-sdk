#!/usr/bin/env node
/**
 * maou-web —— 本机 WebUI
 *
 * 固定入口：
 *   http://127.0.0.1:8787
 *
 *   maou-web
 *   maou-web --port 9000
 *   maou-web --no-open
 */

import { createWebUiServer } from "./create-server.js";
import {
  MAOU_WEBUI_BIND_HOST,
  MAOU_WEBUI_DEFAULT_PORT,
  maouWebUiPublicUrl,
  openInSystemBrowser,
  resolveListenPlan,
} from "./local-entry.js";

function parseArgs(argv: string[]) {
  let explicitPort: number | undefined;
  if (process.env.MAOU_WEBUI_PORT?.trim()) {
    const n = Number(process.env.MAOU_WEBUI_PORT);
    if (Number.isFinite(n) && n > 0) explicitPort = Math.floor(n);
  }
  let bindHost = process.env.MAOU_WEBUI_HOST?.trim() || MAOU_WEBUI_BIND_HOST;
  let projectRoot = process.env.MAOU_PROJECT_ROOT || process.cwd();
  let sandboxMode = process.env.MAOU_SANDBOX_MODE || "yolo";
  let openBrowser = process.env.MAOU_WEBUI_NO_OPEN !== "1";
  let reuse = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--port" || a === "-p") {
      explicitPort = Number(argv[++i] || 0) || explicitPort;
    } else if (a.startsWith("--port=")) {
      explicitPort = Number(a.slice(7)) || explicitPort;
    } else if (a === "--host") {
      bindHost = argv[++i] || bindHost;
    } else if (a === "--cwd") {
      projectRoot = argv[++i] || projectRoot;
    } else if (a === "--sandbox") {
      sandboxMode = argv[++i] || sandboxMode;
    } else if (a === "--no-open") {
      openBrowser = false;
    } else if (a === "--open") {
      openBrowser = true;
    } else if (a === "--no-reuse") {
      reuse = false;
    } else if (a === "--no-elevate") {
      /* ignored: elevation removed */
    } else if (a === "-h" || a === "--help") {
      process.stdout.write(`maou-web — Maou WebUI

固定地址：
  http://127.0.0.1:${MAOU_WEBUI_DEFAULT_PORT}

Usage:
  maou-web [--port ${MAOU_WEBUI_DEFAULT_PORT}] [--host ${MAOU_WEBUI_BIND_HOST}] [--cwd PATH]
           [--sandbox yolo|normal|auto] [--no-open] [--no-reuse]

Env:
  MAOU_WEBUI_PORT  MAOU_WEBUI_HOST  MAOU_PROJECT_ROOT  MAOU_SANDBOX_MODE
  MAOU_WEBUI_NO_OPEN=1
`);
      process.exit(0);
    }
  }
  return {
    explicitPort,
    bindHost,
    projectRoot,
    sandboxMode,
    openBrowser,
    reuse,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const plan = await resolveListenPlan({
    explicitPort: opts.explicitPort,
    bindHost: opts.bindHost,
  });

  if (plan.reuseExisting && opts.reuse) {
    process.stdout.write(`[maou-web] already running → ${plan.publicUrl}\n`);
    if (opts.openBrowser) openInSystemBrowser(plan.publicUrl);
    process.exit(0);
  }

  if (plan.reuseExisting && !opts.reuse) {
    process.stderr.write(
      `[maou-web] already on ${plan.publicUrl}; omit --no-reuse to open it\n`,
    );
    process.exit(1);
  }

  const server = createWebUiServer({
    port: plan.port,
    host: plan.bindHost,
    projectRoot: opts.projectRoot,
    sandboxMode: opts.sandboxMode,
  });

  const started = await server.start();
  const publicUrl = maouWebUiPublicUrl(started.port, started.host);

  process.stdout.write(
    `[maou-web] ${publicUrl}\n` +
      `  project: ${opts.projectRoot}\n` +
      `  sandbox: ${opts.sandboxMode}\n`,
  );

  if (opts.openBrowser) {
    setTimeout(() => openInSystemBrowser(publicUrl), 200);
  }

  const shutdown = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  process.stderr.write(
    `[maou-web] failed: ${e instanceof Error ? e.message : e}\n`,
  );
  process.exit(1);
});
