/**
 * defineSchedule — 定时任务定义 API（对标 Vercel Eve）
 *
 * 用法：在 agent/schedules/ 目录下创建 .ts 文件，导出 defineSchedule() 的返回值。
 * 文件名即任务名（如 monday-summary.ts → 任务名 "monday-summary"）。
 *
 * @example
 * // agent/schedules/monday-summary.ts
 * import { defineSchedule } from "@little-house-studio/agent/define";
 *
 * export default defineSchedule({
 *   cron: "0 9 * * 1",  // 每周一早上9点
 *   instruction: "总结上周的团队数据并生成报告",
 *   timezone: "Asia/Shanghai",
 * });
 */

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export interface DefineScheduleConfig {
  /** cron 表达式（标准5位或6位） */
  cron: string;

  /** 触发时发送给 Agent 的指令 */
  instruction: string;

  /** 时区（默认 "Asia/Shanghai"） */
  timezone?: string;

  /** 是否启用（默认 true） */
  enabled?: boolean;

  /** 任务描述（可选，给人看） */
  description?: string;

  /** 附加配置 */
  config?: Record<string, unknown>;
}

export interface DefinedSchedule {
  readonly _type: "defineSchedule";
  readonly _source: "file";

  /** 任务名（文件名去掉扩展名） */
  name: string;

  /** cron 表达式 */
  cron: string;

  /** 触发指令 */
  instruction: string;

  /** 时区 */
  timezone: string;

  /** 是否启用 */
  enabled: boolean;

  /** 描述 */
  description: string;

  /** 附加配置 */
  config: Record<string, unknown>;
}

/**
 * 定义一个定时任务
 */
export function defineSchedule(config: DefineScheduleConfig): (name: string) => DefinedSchedule {
  return (name: string) => ({
    _type: "defineSchedule",
    _source: "file",
    name,
    cron: config.cron,
    instruction: config.instruction,
    timezone: config.timezone ?? "Asia/Shanghai",
    enabled: config.enabled ?? true,
    description: config.description ?? "",
    config: config.config ?? {},
  });
}

// ─── Cron 调度引擎 ─────────────────────────────────────────────────────────

type ScheduleHandler = (schedule: DefinedSchedule) => void | Promise<void>;

interface ScheduledJob {
  schedule: DefinedSchedule;
  timer: ReturnType<typeof setInterval> | null;
  lastRun: Date | null;
}

/**
 * 简易 cron 调度引擎
 * 解析 cron 表达式并定时触发回调
 *
 * 支持的 cron 格式：
 * ┌───────────── 分钟 (0-59)
 * │ ┌───────────── 小时 (0-23)
 * │ │ ┌───────────── 日 (1-31)
 * │ │ │ ┌───────────── 月 (1-12)
 * │ │ │ │ ┌───────────── 星期 (0-6, 0=周日)
 * │ │ │ │ │
 * * * * * *
 */
export class CronScheduler {
  private _jobs = new Map<string, ScheduledJob>();
  private _handler: ScheduleHandler;
  private _checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(handler: ScheduleHandler) {
    this._handler = handler;
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this._checkInterval) return;
    // 每分钟检查一次
    this._checkInterval = setInterval(() => this._tick(), 60_000);
    // 立即做一次检查
    this._tick();
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
    for (const job of this._jobs.values()) {
      if (job.timer) clearInterval(job.timer);
    }
    this._jobs.clear();
  }

  /**
   * 注册定时任务
   */
  register(schedule: DefinedSchedule): void {
    if (!schedule.enabled) return;
    this._jobs.set(schedule.name, {
      schedule,
      timer: null,
      lastRun: null,
    });
  }

  /**
   * 取消注册
   */
  unregister(name: string): void {
    const job = this._jobs.get(name);
    if (job?.timer) clearInterval(job.timer);
    this._jobs.delete(name);
  }

  /**
   * 列出所有已注册任务
   */
  list(): DefinedSchedule[] {
    return [...this._jobs.values()].map((j) => j.schedule);
  }

  /** 任务数量 */
  get count(): number {
    return this._jobs.size;
  }

  /**
   * 每分钟检查是否需要触发
   */
  private _tick(): void {
    const now = new Date();
    for (const job of this._jobs.values()) {
      if (!job.schedule.enabled) continue;
      if (this._matchesCron(job.schedule.cron, now)) {
        // 避免同一分钟内重复触发
        if (job.lastRun && now.getTime() - job.lastRun.getTime() < 60_000) continue;
        job.lastRun = now;
        // 异步触发，不阻塞
        Promise.resolve(this._handler(job.schedule)).catch(() => { /* ignore */ });
      }
    }
  }

  /**
   * 简易 cron 匹配
   * 支持：* / 数字 , - 范围
   */
  private _matchesCron(cron: string, date: Date): boolean {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return false;

    const fields = [
      date.getMinutes(),
      date.getHours(),
      date.getDate(),
      date.getMonth() + 1,
      date.getDay(),
    ];

    for (let i = 0; i < 5; i++) {
      if (!this._matchesField(parts[i], fields[i])) return false;
    }

    return true;
  }

  private _matchesField(field: string, value: number): boolean {
    if (field === "*") return true;

    // 步长：*/5
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10);
      if (isNaN(step) || step === 0) return false;
      return value % step === 0;
    }

    // 列表：1,3,5
    if (field.includes(",")) {
      return field.split(",").some((f) => this._matchesField(f.trim(), value));
    }

    // 范围：1-5
    if (field.includes("-")) {
      const [start, end] = field.split("-").map((n) => parseInt(n, 10));
      if (isNaN(start) || isNaN(end)) return false;
      return value >= start && value <= end;
    }

    // 精确匹配
    const num = parseInt(field, 10);
    return !isNaN(num) && value === num;
  }
}
