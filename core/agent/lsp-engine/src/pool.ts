/**
 * ServerPool — 每个 (工作区根, 语言) 一个语言服务器，复用+驱逐+崩溃重建。
 */

import { LanguageServer } from "./server.js";
import { resolveSpec, findWorkspaceRoot } from "./registry.js";
import { NoServerForFileError } from "./types.js";

const IDLE_TTL_MS = 5 * 60 * 1000;
const MAX_SERVERS = 8;
const CRASH_WINDOW_MS = 60 * 1000;
const MAX_CRASHES = 3;

interface PoolEntry {
  server: LanguageServer;
  crashes: number[];
}

const pool = new Map<string, PoolEntry>();

/** 为某文件取得（或创建）温热的语言服务器。崩溃熔断后抛错。 */
export async function getServerForFile(file: string): Promise<LanguageServer> {
  const spec = resolveSpec(file);
  if (!spec) throw new NoServerForFileError(file);
  const root = findWorkspaceRoot(file, spec);
  const key = `${root}::${spec.languageId}`;

  let entry = pool.get(key);

  // 已死 → 熔断检查 + 重建
  if (entry && entry.server.isDead()) {
    const now = Date.now();
    entry.crashes = entry.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
    entry.crashes.push(now);
    if (entry.crashes.length >= MAX_CRASHES) {
      throw new Error(`语言服务器 ${spec.languageId} 在 ${CRASH_WINDOW_MS / 1000}s 内崩溃 ${entry.crashes.length} 次，已熔断`);
    }
    entry.server = new LanguageServer(spec, root);
  }

  if (!entry) {
    evictIfNeeded();
    entry = { server: new LanguageServer(spec, root), crashes: [] };
    pool.set(key, entry);
  }

  await entry.server.ensureReady();
  return entry.server;
}

/** LRU + idle 驱逐 */
function evictIfNeeded(): void {
  const now = Date.now();
  // idle 超时
  for (const [key, entry] of pool) {
    if (now - entry.server.lastUsedAt > IDLE_TTL_MS) {
      void entry.server.shutdown();
      pool.delete(key);
    }
  }
  // 超出上限 → 驱逐最久未用
  if (pool.size >= MAX_SERVERS) {
    let oldestKey = "";
    let oldest = Infinity;
    for (const [key, entry] of pool) {
      if (entry.server.lastUsedAt < oldest) {
        oldest = entry.server.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const e = pool.get(oldestKey)!;
      void e.server.shutdown();
      pool.delete(oldestKey);
    }
  }
}

/** 关闭所有服务器 */
export async function shutdownAll(): Promise<void> {
  await Promise.all([...pool.values()].map((e) => e.server.shutdown()));
  pool.clear();
}

/** 关闭某工作区下的服务器 */
export async function cleanupWorkspace(root: string): Promise<void> {
  for (const [key, entry] of pool) {
    if (key.startsWith(`${root}::`)) {
      await entry.server.shutdown();
      pool.delete(key);
    }
  }
}
