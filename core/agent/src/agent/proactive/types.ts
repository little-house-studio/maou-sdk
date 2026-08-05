/**
 * 主动智能（Proactive）—— 共享类型
 * 看板落盘：<project>/.maou/project/PROACTIVE.md
 * 设置落盘：<project>/.maou/project/proactive-settings.json
 */

/** 看板固定分区（顺序即产品语义优先级） */
export const PROACTIVE_ZONES = [
  "高风险框架优化",
  "大模块推进",
  "功能发现与完善",
  "安全无风险修复与优化",
] as const;

export type ProactiveZone = (typeof PROACTIVE_ZONES)[number];

export type ProactiveRisk = "高" | "中" | "低";

export type ProactiveItem = {
  /** Stable id for UI / dispatch (hash of zone+title or explicit) */
  id: string;
  zone: ProactiveZone | "已完成";
  title: string;
  risk: ProactiveRisk | string;
  comment: string;
  note: string;
  done: boolean;
  /** ISO when marked done */
  doneAt?: string;
};

export type ProactiveBoard = {
  path: string;
  zones: ProactiveZone[];
  items: ProactiveItem[];
  raw: string;
};

export type ProactiveFrequency = "off" | "after_edit" | "interval";

export type ProactiveSettings = {
  /** Master switch */
  enabled: boolean;
  frequency: ProactiveFrequency;
  /** Used when frequency === "interval" */
  intervalMinutes: number;
  /** Cap automatic scan/dispatch cycles per calendar day */
  maxRunsPerDay: number;
  /** Zones that auto-check + auto-dispatch after scan */
  autoZones: ProactiveZone[];
  /** Bookkeeping */
  runsToday: number;
  runsDay: string; // YYYY-MM-DD
  lastScanAt?: string;
  lastDispatchAt?: string;
};

export type ProactiveJobState =
  | { status: "idle" }
  | { status: "scanning"; startedAt: string }
  | { status: "dispatching"; startedAt: string; itemIds: string[] }
  | { status: "error"; message: string; at: string };

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: false,
  frequency: "off",
  intervalMinutes: 30,
  maxRunsPerDay: 20,
  autoZones: ["安全无风险修复与优化"],
  runsToday: 0,
  runsDay: "",
};

export type ProactiveChatLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ts: string;
};
