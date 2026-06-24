/**
 * 定时任务注册表 —— 自动发现 schedules/ 目录下的定时配置
 *
 * 每个定时任务 = 一个 .json 文件，文件名即任务名。
 * 支持标准 cron 表达式。
 *
 * 约定优于配置：放文件即注册，删文件即移除。
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface ScheduleConfig {
  /** cron 表达式，如 "0 9 * * 1-5"（工作日每天 9:00） */
  cron: string;
  /** 触发时发送给 Agent 的指令 */
  instruction: string;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 时区，默认 "Asia/Shanghai" */
  timezone?: string;
  /** 附加配置 */
  [key: string]: unknown;
}

interface ScheduleRecord {
  name: string;
  config: ScheduleConfig;
  agentName: string;
  filePath: string;
}

// ─── ScheduleRegistry ──────────────────────────────────────────────────────

export class ScheduleRegistry {
  private _schedules = new Map<string, ScheduleRecord>();
  private _maouRoot: string;

  constructor(maouRoot: string) {
    this._maouRoot = maouRoot;
  }

  /**
   * 扫描所有 agent 的 schedules/ 目录，加载定时任务配置
   */
  loadAll(agentNames: string[]): number {
    this._schedules.clear();
    let count = 0;

    for (const agentName of agentNames) {
      const schedulesDir = join(this._maouRoot, "agents", agentName, "schedules");
      if (!existsSync(schedulesDir)) continue;

      try {
        const entries = readdirSync(schedulesDir).sort();
        for (const entry of entries) {
          if (!entry.endsWith(".json")) continue;
          if (entry === ".gitkeep") continue;

          const fullPath = join(schedulesDir, entry);
          try {
            const data = JSON.parse(readFileSync(fullPath, "utf-8"));
            if (data && typeof data === "object" && "cron" in data) {
              const name = entry.replace(/\.json$/, "");
              const key = `${agentName}:${name}`;
              this._schedules.set(key, {
                name,
                config: data as ScheduleConfig,
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
   * 获取指定 agent 的所有定时任务
   */
  getSchedulesForAgent(agentName: string): ScheduleRecord[] {
    const result: ScheduleRecord[] = [];
    for (const sch of this._schedules.values()) {
      if (sch.agentName === agentName) {
        result.push(sch);
      }
    }
    return result;
  }

  /**
   * 获取所有已启用的定时任务
   */
  getEnabledSchedules(agentName?: string): ScheduleRecord[] {
    const result: ScheduleRecord[] = [];
    for (const sch of this._schedules.values()) {
      if (sch.config.enabled === false) continue;
      if (agentName && sch.agentName !== agentName) continue;
      result.push(sch);
    }
    return result;
  }

  /**
   * 按 key 获取定时任务
   */
  get(key: string): ScheduleRecord | undefined {
    return this._schedules.get(key);
  }

  /**
   * 列出所有定时任务
   */
  listAll(): ScheduleRecord[] {
    return [...this._schedules.values()];
  }

  /**
   * 创建定时任务（写入 .json 文件）
   */
  create(agentName: string, name: string, config: ScheduleConfig): ScheduleRecord {
    const schedulesDir = join(this._maouRoot, "agents", agentName, "schedules");
    mkdirSync(schedulesDir, { recursive: true });
    const fullPath = join(schedulesDir, `${name}.json`);
    writeFileSync(fullPath, JSON.stringify(config, null, 2), "utf-8");

    const key = `${agentName}:${name}`;
    const record: ScheduleRecord = { name, config, agentName, filePath: fullPath };
    this._schedules.set(key, record);
    return record;
  }

  /**
   * 删除定时任务（删除 .json 文件）
   */
  delete(agentName: string, name: string): boolean {
    const key = `${agentName}:${name}`;
    const record = this._schedules.get(key);
    if (!record) return false;

    try {
      rmSync(record.filePath, { force: true });
    } catch { /* ignore */ }

    this._schedules.delete(key);
    return true;
  }

  /** 任务数量 */
  get count(): number {
    return this._schedules.size;
  }
}
