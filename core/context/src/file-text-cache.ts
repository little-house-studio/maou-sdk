/**
 * 按 mtime+size 缓存文本文件。项目说明 / AGENTS.md 热路径每轮只 stat，不重读。
 */

import { existsSync, readFileSync, statSync } from "node:fs";

type Snap = { mtime: number; size: number; text: string };

const cache = new Map<string, Snap>();
let reads = 0;

export function readTextCached(path: string): string | null {
  if (!existsSync(path)) {
    cache.delete(path);
    return null;
  }
  let st;
  try {
    st = statSync(path);
  } catch {
    cache.delete(path);
    return null;
  }
  if (!st.isFile()) {
    cache.delete(path);
    return null;
  }
  const prev = cache.get(path);
  if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) return prev.text;
  reads += 1;
  const text = readFileSync(path, "utf-8");
  cache.set(path, { mtime: st.mtimeMs, size: st.size, text });
  return text;
}

export function cachedFileReadCount(): number {
  return reads;
}

export function resetFileTextCache(): void {
  cache.clear();
  reads = 0;
}
