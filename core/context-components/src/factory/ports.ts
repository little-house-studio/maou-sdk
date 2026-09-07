/**
 * 上下文工厂端口。零件只认这些形状，不认传统方案。
 */

import type { MicroCompactCatalog } from "../micro-compact.js";
import type { MaouMessage } from "../types/message.js";

/** 会话目录怎么摆。默认是 maouSessionLayout。 */
export interface SessionLayout {
  readonly sessionDir: string;
  sessionRoot(sessionId: string): string;
  eventsPath(sessionId: string): string;
  metaPath(sessionId: string): string;
  harnessPath(sessionId: string): string;
  harnessBackupPath(sessionId: string): string;
  foldCachePath(sessionId: string): string;
  listCachePath(): string;
  searchDbPath(): string;
}

/** 会话记录可卸的功能。缺省全开，和现在的 SessionStore 一样。 */
export interface SessionRecordFeatures {
  /** 会话全文检索 search.sqlite */
  search?: boolean;
  /** 超大 events.jsonl 封存 */
  archive?: boolean;
  /** 会话列表投影 list-cache.json */
  listCache?: boolean;
  /** 当前枝折叠缓存 fold.json */
  foldCache?: boolean;
  /** 冷打开补未闭合工具 / 半截轮次 */
  toolRecovery?: boolean;
  /** 按 entryId 选枝；关掉就是线性一条 */
  tree?: boolean;
}

export const DEFAULT_SESSION_FEATURES: Required<SessionRecordFeatures> = {
  search: true,
  archive: true,
  listCache: true,
  foldCache: true,
  toolRecovery: true,
  tree: true,
};

export function resolveSessionFeatures(
  partial?: SessionRecordFeatures,
): Required<SessionRecordFeatures> {
  return { ...DEFAULT_SESSION_FEATURES, ...partial };
}

export interface SessionRecordOptions {
  layout?: SessionLayout;
  features?: SessionRecordFeatures;
}

export type AssemblyMessage = Record<string, unknown> & {
  role: string;
};

export interface AssemblySlot<TCtx = unknown> {
  name: string;
  order: number;
  /**
   * 稳定前缀（prompt cache 前）。
   * 缺省：order < 100 算前缀。
   */
  prefix?: boolean;
  enabled?: (ctx: TCtx) => boolean;
  provide: (ctx: TCtx) => AssemblyMessage[] | AssemblyMessage | string | null | undefined;
  /** provide 返回字符串时用的 role，默认 system */
  role?: string;
}

export interface AssemblyHookMeta {
  prefixCount: number;
}

export interface AssemblyHook<TCtx = unknown> {
  name: string;
  apply(
    messages: AssemblyMessage[],
    ctx: TCtx,
    meta: AssemblyHookMeta,
  ): void | AssemblyMessage[];
}

export interface FoldStageConfig {
  enabled: boolean;
  /** 全上下文占用达到该比例才折叠，默认 80 */
  triggerPercent: number;
  /** 折叠区达到窗口该比例则归档，默认 50 */
  archiveFoldedPercent: number;
  /** 尾巴留原文的条数比例 */
  retainTailRatio: number;
}

/** 传统方案大压缩两条路。 */
export const TRADITIONAL_MAJOR_SCHEMES = ["fold", "llm"] as const;
export type TraditionalMajorScheme = (typeof TRADITIONAL_MAJOR_SCHEMES)[number];

export function resolveTraditionalMajorScheme(
  raw?: unknown,
  foldStage?: Partial<FoldStageConfig> | false,
): TraditionalMajorScheme {
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (key === "llm" || key === "summarize" || key === "direct") return "llm";
  if (key === "fold") return "fold";
  if (foldStage === false) return "llm";
  return "fold";
}

export interface FoldStepInput {
  history: MaouMessage[];
  maxTokens?: number;
  knownTokens?: number;
  currentTurn?: number;
  catalog?: MicroCompactCatalog;
  sessionRoot?: string;
  sessionId?: string;
  /** false 关闭折叠阶段；缺省走传统默认（开） */
  foldStage?: Partial<FoldStageConfig> | false;
}

export interface FoldStepOutput {
  history: MaouMessage[];
  changed?: boolean;
  extras?: Record<string, unknown>;
}

export interface FoldStep {
  name: string;
  apply(input: FoldStepInput): FoldStepOutput | void | Promise<FoldStepOutput | void>;
}
