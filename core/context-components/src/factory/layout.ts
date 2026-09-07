import { join } from "node:path";
import { FOLD_CACHE_FILE } from "../fold-cache.js";
import { LIST_CACHE_FILE } from "../list-cache.js";
import { EVENTS_FILE } from "../session-ledger.js";
import { SEARCH_DB_FILE } from "../session-search-index.js";
import type { SessionLayout } from "./ports.js";

const META_FILE = "session.json";

/**
 * 默认会话目录：
 *   <sessionDir>/<id>/session.json
 *   <sessionDir>/<id>/events.jsonl
 *   <sessionDir>/<id>/harness.json
 *   <sessionDir>/list-cache.json
 *   <sessionDir>/search.sqlite
 *
 * 换目录布局：实现 SessionLayout，或在这份上改路径。
 * SessionStore 的账本仍按 sessionDir + sessionId 写 events.jsonl；
 * 自定义整库结构请直接用 ledger / durable-write 零件。
 */
export function maouSessionLayout(sessionDir: string): SessionLayout {
  return {
    sessionDir,
    sessionRoot: (sessionId) => join(sessionDir, sessionId),
    eventsPath: (sessionId) => join(sessionDir, sessionId, EVENTS_FILE),
    metaPath: (sessionId) => join(sessionDir, sessionId, META_FILE),
    harnessPath: (sessionId) => join(sessionDir, sessionId, "harness.json"),
    harnessBackupPath: (sessionId) => join(sessionDir, sessionId, "harness.bak.json"),
    foldCachePath: (sessionId) => join(sessionDir, sessionId, FOLD_CACHE_FILE),
    listCachePath: () => join(sessionDir, LIST_CACHE_FILE),
    searchDbPath: () => join(sessionDir, SEARCH_DB_FILE),
  };
}
