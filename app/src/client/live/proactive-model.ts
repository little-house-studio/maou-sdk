/**
 * Client-side proactive board grammar (zones + queue mark).
 * Server loop stays in Agent ProactiveService; this file does not import it.
 */
export const PROACTIVE_ZONES = [
  "高风险框架优化",
  "大模块推进",
  "功能发现与完善",
  "安全无风险修复与优化",
] as const;

export type ProactiveZone = (typeof PROACTIVE_ZONES)[number];
export type ProactiveRisk = "高" | "中" | "低";
export type ProactiveFrequency = "off" | "after_edit" | "interval";

export type ProactiveItem = {
  id: string;
  zone: ProactiveZone | "已完成";
  title: string;
  risk: ProactiveRisk | string;
  comment: string;
  note: string;
  done: boolean;
  doneAt?: string;
};

export type ProactiveBoard = {
  path: string;
  zones: ProactiveZone[];
  items: ProactiveItem[];
  raw: string;
};

export type ProactiveSettings = {
  enabled: boolean;
  frequency: ProactiveFrequency;
  intervalMinutes: number;
  maxRunsPerDay: number;
  autoZones: ProactiveZone[];
  runsToday: number;
  runsDay: string;
  lastScanAt?: string;
  lastDispatchAt?: string;
};

export type ProactiveJobState =
  | { status: "idle" }
  | { status: "scanning"; startedAt: string }
  | { status: "dispatching"; startedAt: string; itemIds: string[] }
  | { status: "error"; message: string; at: string };

export type ProactiveChatLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ts: string;
};

export function isQueued(item: { note: string }): boolean {
  return /\[queue\]/i.test(item.note);
}
