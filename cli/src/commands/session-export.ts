/**
 * `maou session export <id> -o <path>`
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SessionStore, exportSessionZip, preflightSessionExport, sessionZipFilename } from "@little-house-studio/context";
import { projectSessionsDir } from "../config/paths.js";
import { resolveLatestSessionId } from "../lib/session-analyze.js";

export interface SessionExportCliOpts {
  cwd?: string;
  sessionId?: string;
  out?: string;
  argv?: string[];
}

function parseArgv(argv: string[]): { sessionId?: string; out?: string } {
  let sessionId: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o" || a === "--out" || a === "--output") {
      out = argv[++i];
      continue;
    }
    if (a.startsWith("-")) continue;
    if (!sessionId) sessionId = a;
  }
  return { sessionId, out };
}

export function runSessionExport(opts: SessionExportCliOpts = {}): boolean {
  const cwd = opts.cwd ?? process.cwd();
  const parsed = opts.argv ? parseArgv(opts.argv) : { sessionId: opts.sessionId, out: opts.out };
  let id = parsed.sessionId;
  if (!id) id = resolveLatestSessionId(cwd) ?? undefined;
  if (!id) {
    process.stderr.write(
      "❌ 未找到会话。请指定 sessionId。\n" +
        "   用法: maou session export [sessionId] -o <file.zip>\n",
    );
    return false;
  }
  const store = new SessionStore(projectSessionsDir(cwd));
  const pre = preflightSessionExport(store, id);
  if (!pre.ok) {
    process.stderr.write(`❌ ${pre.error ?? "session not found"}\n`);
    return false;
  }
  const dest = resolve(cwd, parsed.out || sessionZipFilename(id));
  try {
    writeFileSync(dest, exportSessionZip(store, id));
    process.stderr.write(`✓ 已导出 ${dest}\n`);
    return true;
  } catch (e) {
    process.stderr.write(`❌ ${(e as Error).message ?? e}\n`);
    return false;
  }
}
