#!/usr/bin/env node
/**
 * maou-agent CLI 入口
 * 对应 Python: cli/__main__.py + start.py
 *
 * 用法:
 *   maou [--port 8099] [--host 127.0.0.1] [--no-server]
 */

import * as os from "node:os";
import { join } from "node:path";
import { MaouServer } from "../harness/server.js";

function parseArgs(argv: string[]): { port: number; host: string; noServer: boolean } {
  let port = parseInt(process.env.MAOU_PORT || "8099", 10);
  let host = process.env.MAOU_HOST || "127.0.0.1";
  let noServer = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && i + 1 < argv.length) {
      port = parseInt(argv[++i], 10);
    } else if (arg === "--host" && i + 1 < argv.length) {
      host = argv[++i];
    } else if (arg === "--no-server") {
      noServer = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`maou-agent — AI Agent Runtime

Usage:
  maou [options]

Options:
  --port <port>    Server port (default: 8099)
  --host <host>    Server host (default: 127.0.0.1)
  --no-server      Skip HTTP server, CLI-only mode
  -h, --help       Show this help message
`);
      process.exit(0);
    }
  }

  return { port, host, noServer };
}

const { port, host, noServer } = parseArgs(process.argv);

if (noServer) {
  console.log("CLI-only mode (server disabled).");
  // TODO: 未来支持纯 CLI 交互模式
  process.exit(0);
}

const server = new MaouServer({ userRoot: join(os.homedir(), ".maou") });
try {
  server.start(port, host);
} catch (err: unknown) {
  console.error("Failed to start server:", err);
  process.exit(1);
}
