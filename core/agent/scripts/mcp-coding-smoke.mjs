#!/usr/bin/env node
/**
 * Coding Agent MCP smoke (real stdio transport + Runtime path).
 *
 * 1. Writes connections/echo.json under a temp or given maouRoot for agent "coding"
 * 2. Builds Runtime the same way coding-agent does (createStandardAgentDeps + Runtime)
 * 3. Calls Runtime.ensureMcpConnections("coding")
 * 4. Invokes mcp__echo__echo / mcp__echo__ping via ToolRegistry
 *
 * Exit 0 on success. Logs JSON summary to stdout.
 *
 *   node scripts/mcp-coding-smoke.mjs
 *   MAOU_ROOT=/tmp/foo node scripts/mcp-coding-smoke.mjs
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentPkgRoot = join(__dirname, "..");
const fixturePath = join(__dirname, "mcp-echo-fixture.mjs");

// Resolve workspace packages from built dist
const require = createRequire(join(agentPkgRoot, "package.json"));

async function main() {
  const keep = process.env.MCP_SMOKE_KEEP === "1";
  const maouRoot =
    process.env.MAOU_ROOT ??
    join(tmpdir(), `maou-mcp-smoke-${Date.now()}`);
  const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
  const agentName = process.env.MCP_SMOKE_AGENT ?? "coding";

  mkdirSync(join(maouRoot, "agents", agentName, "connections"), {
    recursive: true,
  });

  const connPath = join(
    maouRoot,
    "agents",
    agentName,
    "connections",
    "echo.json",
  );
  writeFileSync(
    connPath,
    JSON.stringify(
      {
        type: "mcp",
        description: "Demo echo MCP (stdio fixture for coding smoke)",
        command: process.execPath,
        args: [fixturePath],
        transport: "stdio",
        enabled: true,
      },
      null,
      2,
    ),
    "utf-8",
  );

  // Dynamic import from package dist (must be built)
  const agentDist = join(agentPkgRoot, "dist/index.js");
  const {
    Runtime,
    createStandardAgentDeps,
  } = await import(agentDist);

  const deps = createStandardAgentDeps(projectRoot, maouRoot, {
    installReviewer: false,
  });

  const logs = [];
  const runtime = new Runtime({
    ...deps,
    maouRoot,
    projectRoot,
    enablePostLogger: false,
    log: (level, msg) => {
      logs.push(`[${level}] ${msg}`);
    },
  });

  const result = await runtime.ensureMcpConnections(agentName);
  const toolNames = result.toolNames ?? [];

  if (!toolNames.includes("mcp__echo__echo")) {
    throw new Error(
      `expected mcp__echo__echo in tools, got: ${JSON.stringify(toolNames)}`,
    );
  }
  if (!toolNames.includes("mcp__echo__ping")) {
    throw new Error(
      `expected mcp__echo__ping in tools, got: ${JSON.stringify(toolNames)}`,
    );
  }

  const registry = deps.toolRegistry;
  const echo = registry.get("mcp__echo__echo");
  const ping = registry.get("mcp__echo__ping");
  if (!echo || !ping) {
    throw new Error("tools registered by name but registry.get failed");
  }

  const ctx = {
    sessionId: "mcp-smoke",
    projectRoot,
    promptRoot: projectRoot,
    sandboxRoot: projectRoot,
    sandboxMode: "off",
    agentName,
    agentMode: "agent",
    pluginSettings: {},
    workingDir: projectRoot,
  };

  const echoOut = await echo.execute({ text: "coding-ok" }, ctx);
  if (!echoOut.ok || echoOut.message !== "echo:coding-ok") {
    throw new Error(`echo tool failed: ${JSON.stringify(echoOut)}`);
  }

  const pingOut = await ping.execute({}, ctx);
  if (!pingOut.ok || pingOut.message !== "pong") {
    throw new Error(`ping tool failed: ${JSON.stringify(pingOut)}`);
  }

  // resources via manager
  const session = result.manager?.getSession?.("echo");
  let resourceText = null;
  if (session?.connected) {
    const read = await session.readResource("fixture://smoke-note");
    resourceText = read.contents?.[0]?.text ?? null;
  }

  // cleanup MCP processes
  await result.manager?.disconnectAll?.().catch(() => {});

  const summary = {
    ok: true,
    maouRoot,
    agentName,
    connectionFile: connPath,
    fixturePath,
    discovered: result.discovered,
    connected: result.ok,
    failed: result.failed,
    toolNames,
    echo: echoOut.message,
    ping: pingOut.message,
    resourceText,
    states: result.states,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!keep && !process.env.MAOU_ROOT) {
    rmSync(maouRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
