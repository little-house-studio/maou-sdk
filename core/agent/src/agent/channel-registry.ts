/**
 * 消息通道注册表 —— 自动发现 channels/ 目录下的通道配置
 *
 * 每个通道 = 一个 .json 文件，文件名即通道名。
 * 支持的通道类型：http / feishu / slack / discord / webhook
 *
 * 约定优于配置：放文件即注册，删文件即移除。
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface ChannelConfig {
  /** 通道类型：http / feishu / slack / discord / webhook */
  type: string;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 通道特定配置 */
  [key: string]: unknown;
}

interface ChannelRecord {
  name: string;
  config: ChannelConfig;
  agentName: string;
  filePath: string;
}

// ─── ChannelRegistry ───────────────────────────────────────────────────────

export class ChannelRegistry {
  private _channels = new Map<string, ChannelRecord>();
  private _maouRoot: string;

  constructor(maouRoot: string) {
    this._maouRoot = maouRoot;
  }

  /**
   * 扫描所有 agent 的 channels/ 目录，加载通道配置
   */
  loadAll(agentNames: string[]): number {
    this._channels.clear();
    let count = 0;

    for (const agentName of agentNames) {
      const channelsDir = join(this._maouRoot, "agents", agentName, "channels");
      if (!existsSync(channelsDir)) continue;

      try {
        const entries = readdirSync(channelsDir).sort();
        for (const entry of entries) {
          if (!entry.endsWith(".json")) continue;
          if (entry === ".gitkeep") continue;

          const fullPath = join(channelsDir, entry);
          try {
            const data = JSON.parse(readFileSync(fullPath, "utf-8"));
            if (data && typeof data === "object" && "type" in data) {
              const name = entry.replace(/\.json$/, "");
              const key = `${agentName}:${name}`;
              this._channels.set(key, {
                name,
                config: data as ChannelConfig,
                agentName,
                filePath: fullPath,
              });
              count++;
            }
          } catch { /* skip malformed */ }
        }
      } catch { /* skip unreadable dir */ }
    }

    return count;
  }

  /**
   * 获取指定 agent 的所有通道
   */
  getChannelsForAgent(agentName: string): ChannelRecord[] {
    const result: ChannelRecord[] = [];
    for (const ch of this._channels.values()) {
      if (ch.agentName === agentName) {
        result.push(ch);
      }
    }
    return result;
  }

  /**
   * 获取所有已启用的通道
   */
  getEnabledChannels(agentName?: string): ChannelRecord[] {
    const result: ChannelRecord[] = [];
    for (const ch of this._channels.values()) {
      if (ch.config.enabled === false) continue;
      if (agentName && ch.agentName !== agentName) continue;
      result.push(ch);
    }
    return result;
  }

  /**
   * 按 key 获取通道
   */
  get(key: string): ChannelRecord | undefined {
    return this._channels.get(key);
  }

  /**
   * 列出所有通道
   */
  listAll(): ChannelRecord[] {
    return [...this._channels.values()];
  }

  /**
   * 创建通道（写入 .json 文件）
   */
  create(agentName: string, name: string, config: ChannelConfig): ChannelRecord {
    const channelsDir = join(this._maouRoot, "agents", agentName, "channels");
    mkdirSync(channelsDir, { recursive: true });
    const fullPath = join(channelsDir, `${name}.json`);
    writeFileSync(fullPath, JSON.stringify(config, null, 2), "utf-8");

    const key = `${agentName}:${name}`;
    const record: ChannelRecord = { name, config, agentName, filePath: fullPath };
    this._channels.set(key, record);
    return record;
  }

  /**
   * 删除通道（删除 .json 文件）
   */
  delete(agentName: string, name: string): boolean {
    const key = `${agentName}:${name}`;
    const record = this._channels.get(key);
    if (!record) return false;

    try {
      rmSync(record.filePath, { force: true });
    } catch { /* ignore */ }

    this._channels.delete(key);
    return true;
  }

  /** 通道数量 */
  get count(): number {
    return this._channels.size;
  }
}
