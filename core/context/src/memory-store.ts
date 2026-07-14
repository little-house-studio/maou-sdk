/**
 * 记忆存储 —— 结构化记忆持久化与召回。
 * 每条记忆包含 key/value/category/tags，可跨会话召回。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type { MemoryEntry, MemoryRecallResult, ExtractedMemory } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function genId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export class MemoryStore {
  private memoryDir: string;
  private indexFile: string;

  constructor(maouRoot: string, agentName: string) {
    this.memoryDir = join(maouRoot, "agents", agentName, "memories");
    mkdirSync(this.memoryDir, { recursive: true });
    this.indexFile = join(this.memoryDir, "index.jsonl");
  }

  // ─── 写操作 ────────────────────────────────────────────────────────────────

  /** 存储一条记忆 */
  store(
    memory: ExtractedMemory & { sourceSessionId: string },
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: genId(),
      key: memory.key,
      value: memory.value,
      category: memory.category,
      tags: memory.tags,
      sourceSessionId: memory.sourceSessionId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      accessCount: 0,
    };

    appendFileSync(this.indexFile, JSON.stringify(entry) + "\n", "utf-8");
    return entry;
  }

  /** 更新一条记忆 */
  update(
    id: string,
    updates: Partial<Pick<MemoryEntry, "value" | "tags" | "category">>,
  ): MemoryEntry | null {
    const entries = this._loadAll();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return null;

    Object.assign(entries[idx], updates, { updatedAt: nowIso() });
    this._rewriteAll(entries);
    return entries[idx];
  }

  /** 删除一条记忆 */
  delete(id: string): boolean {
    const entries = this._loadAll();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return false;

    entries.splice(idx, 1);
    this._rewriteAll(entries);
    return true;
  }

  // ─── 读操作 ────────────────────────────────────────────────────────────────

  /** 按关键词召回记忆 */
  recall(query: string, limit?: number): MemoryRecallResult {
    const entries = this._loadAll();
    // 同分时按 key 稳定排序：避免每轮 accessCount 微变导致记忆顺序翻转，
    // 进而打掉 provider 的 prompt prefix cache（常见块大小 ~8192 tokens）。
    const scored = entries.map(e => ({
      entry: e,
      score: this._computeRelevance(query, e),
    })).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.key.localeCompare(b.entry.key);
    });

    const top = (limit ?? 10) > 0 ? scored.slice(0, limit ?? 10) : scored;
    const memories = top.map(s => {
      s.entry.accessCount++;
      return s.entry;
    });

    // 更新 accessCount
    if (memories.length > 0) {
      this._rewriteAll(entries);
    }

    return {
      memories,
      // 再按 key 稳定排一次输出，使 formattedContext 与分数抖动解耦
      formattedContext: this._formatForContext(
        [...memories].sort((a, b) => a.key.localeCompare(b.key)),
      ),
    };
  }

  /** 按分类召回 */
  recallByCategory(category: string, limit?: number): MemoryRecallResult {
    const entries = this._loadAll();
    const filtered = entries.filter(e => e.category === category);

    const memories = (limit ?? 10) > 0 ? filtered.slice(0, limit ?? 10) : filtered;
    return {
      memories,
      formattedContext: this._formatForContext(memories),
    };
  }

  /** 按标签召回 */
  recallByTags(tags: string[], limit?: number): MemoryRecallResult {
    const entries = this._loadAll();
    const filtered = entries.filter(e =>
      tags.some(t => e.tags.includes(t)),
    );

    const memories = (limit ?? 10) > 0 ? filtered.slice(0, limit ?? 10) : filtered;
    return {
      memories,
      formattedContext: this._formatForContext(memories),
    };
  }

  /** 按来源会话召回 */
  recallBySession(sessionId: string): MemoryEntry[] {
    return this._loadAll().filter(e => e.sourceSessionId === sessionId);
  }

  /** 列出所有记忆 */
  list(): MemoryEntry[] {
    return this._loadAll();
  }

  // ─── 维护 ──────────────────────────────────────────────────────────────────

  /** 压缩：去重 + 清理过期（超过 30 天未访问的 normal 类记忆） */
  compact(): { removed: number } {
    const entries = this._loadAll();

    // 去重：相同 key 保留最新的
    const byKey = new Map<string, MemoryEntry>();
    for (const e of entries) {
      const existing = byKey.get(e.key);
      if (!existing || e.updatedAt > existing.updatedAt) {
        byKey.set(e.key, e);
      }
    }

    // 过期清理
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const kept = Array.from(byKey.values()).filter(e => {
      // user_preference 和 project_fact 不过期
      if (e.category === "user_preference" || e.category === "project_fact") {
        return true;
      }
      // 其他超过 30 天未访问的删除
      const lastAccess = new Date(e.updatedAt).getTime();
      return now - lastAccess < thirtyDays;
    });

    const removed = entries.length - kept.length;
    if (removed > 0) {
      this._rewriteAll(kept);
    }

    return { removed };
  }

  // ─── 内部 ──────────────────────────────────────────────────────────────────

  private _loadAll(): MemoryEntry[] {
    if (!existsSync(this.indexFile)) return [];

    const lines = readFileSync(this.indexFile, "utf-8").split("\n");
    const entries: MemoryEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as MemoryEntry);
      } catch {
        continue;
      }
    }
    return entries;
  }

  private _rewriteAll(entries: MemoryEntry[]): void {
    const tmp = `${this.indexFile}.tmp.${Date.now()}`;
    writeFileSync(tmp, entries.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");
    unlinkSync(this.indexFile);
    // renameSync 需要同一文件系统
    writeFileSync(this.indexFile, readFileSync(tmp), "utf-8");
    unlinkSync(tmp);
  }

  private _computeRelevance(query: string, memory: MemoryEntry): number {
    // 简单的词袋匹配
    const tokens = query.toLowerCase().split(/\s+/);
    const keyTokens = memory.key.toLowerCase().split(/_/);
    const valueTokens = memory.value.toLowerCase().split(/\s+/);
    const tagTokens = memory.tags.map(t => t.toLowerCase());

    let score = 0;
    for (const t of tokens) {
      if (tagTokens.includes(t)) score += 3;
      if (valueTokens.some(v => v.includes(t))) score += 1;
      if (keyTokens.some(k => k.includes(t))) score += 2;
    }

    // 时间衰减：30 天内不衰减
    const age = Date.now() - new Date(memory.createdAt).getTime();
    const ageDays = age / (24 * 60 * 60 * 1000);
    if (ageDays < 30) {
      score *= 1.0;
    } else {
      score *= 0.8;  // 超过 30 天衰减 20%
    }

    // accessCount 加权：常用记忆稍微优先
    score += Math.min(memory.accessCount, 10) * 0.1;

    return score;
  }

  private _formatForContext(memories: MemoryEntry[]): string {
    if (memories.length === 0) return "";

    const lines: string[] = [
      "<structured_memory>",
      "以下是从历史对话中提取的结构化记忆，供参考以保持跨会话上下文连贯性：",
      "",
    ];

    for (const m of memories) {
      lines.push(`[${m.category}] ${m.key}: ${m.value}`);
    }

    lines.push("", "</structured_memory>");
    return lines.join("\n");
  }
}