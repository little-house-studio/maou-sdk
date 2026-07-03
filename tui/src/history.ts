/**
 * 输入历史存储 —— Pi Editor 的 HistoryStorage 接口实现。
 * 内存 + JSON 文件持久化（~/.maou/history.json）。
 * 上键空输入/首行时 Editor 自动触发 navigateHistory 填充历史。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

interface HistoryEntry {
  prompt: string;
}

export interface HistoryStorage {
  add(prompt: string, cwd?: string): Promise<void>;
  getRecent(limit: number): HistoryEntry[];
}

const HISTORY_LIMIT = 100;

/** 简单的 JSON 文件历史存储（~/.maou/history.json） */
export class FileHistoryStorage implements HistoryStorage {
  private entries: string[] = [];
  private path: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(path?: string) {
    this.path = path ?? join(homedir(), ".maou", "history.json");
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        const data = JSON.parse(readFileSync(this.path, "utf-8"));
        this.entries = Array.isArray(data.prompts) ? data.prompts.filter((p: unknown) => typeof p === "string") : [];
      }
    } catch {
      this.entries = [];
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify({ prompts: this.entries }, null, 2), "utf-8");
      } catch {
        // 落盘失败不影响功能
      }
      this.saveTimer = null;
    }, 200);
  }

  async add(prompt: string, _cwd?: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    // 去重连续重复
    if (this.entries.length > 0 && this.entries[0] === trimmed) return;
    // 全量去重（移除旧的相同条目）
    this.entries = this.entries.filter(e => e !== trimmed);
    this.entries.unshift(trimmed);
    if (this.entries.length > HISTORY_LIMIT) this.entries.length = HISTORY_LIMIT;
    this.scheduleSave();
  }

  getRecent(limit: number): HistoryEntry[] {
    return this.entries.slice(0, limit).map(prompt => ({ prompt }));
  }
}
