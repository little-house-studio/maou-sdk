/**
 * 分段压缩模块：微压缩 → 大压缩 → 归档，可按轮只升一级。
 */

import type { TraditionalMajorScheme } from "@little-house-studio/context-components";
import { compressMaou } from "../compressor.js";
import type { CompressionStage } from "../types/compression.js";
import type { MaouMessage } from "../types/message.js";
import type {
  ContextCompressContext,
  ContextModule,
  ContextModuleResult,
  SummaryModelConfig,
} from "./types.js";
import { DEFAULT_SUMMARIZER_PROMPT } from "./types.js";

export interface StagedCompressConfig {
  compactTriggerPercent: number;
  summaryTriggerPercent: number;
  archiveTriggerPercent: number;
  /** 最近原文区占路由窗口的比例 */
  retainTailRatio: number;
  activeWindowPercent: number;
  microSingleMsgChars: number;
  summarizerPrompt: string;
  summaryModel: SummaryModelConfig;
  /** true：每轮只升一级；false：一次压到当前占用对应的阶段 */
  progressive: boolean;
  /**
   * 传统大压缩：`fold` 先折，折叠区满了再 LLM 归档；
   * `llm` 一到阈值就摘要并把原文查表路径留下来。
   */
  majorScheme: TraditionalMajorScheme;
}

export const DEFAULT_STAGED_CONFIG: StagedCompressConfig = {
  compactTriggerPercent: 80,
  summaryTriggerPercent: 80,
  archiveTriggerPercent: 90,
  retainTailRatio: 0.16,
  activeWindowPercent: 40,
  microSingleMsgChars: 800,
  summarizerPrompt: DEFAULT_SUMMARIZER_PROMPT,
  summaryModel: {},
  progressive: true,
  majorScheme: "fold",
};

const STAGE_ORDER: CompressionStage[] = [
  "activeStage",
  "compactStage",
  "summaryStage",
  "archiveStage",
];

function requiredStage(ratio: number, cfg: StagedCompressConfig): CompressionStage {
  if (ratio >= cfg.archiveTriggerPercent / 100) return "archiveStage";
  if (ratio >= cfg.summaryTriggerPercent / 100) return "summaryStage";
  if (ratio >= cfg.compactTriggerPercent / 100) return "compactStage";
  return "activeStage";
}

function nextStage(current: CompressionStage, required: CompressionStage): CompressionStage {
  const ci = STAGE_ORDER.indexOf(current);
  const ri = STAGE_ORDER.indexOf(required);
  if (ri > ci) return STAGE_ORDER[ci + 1]!;
  return current;
}

function idle(history: MaouMessage[], tokens: number): ContextModuleResult {
  return {
    compressed: false,
    stage: "activeStage",
    history,
    droppedSummary: "",
    originalTokens: tokens,
    compressedTokens: tokens,
    blockIds: [],
  };
}

export const stagedContextModule: ContextModule<StagedCompressConfig> = {
  id: "staged",
  defaultConfig: { ...DEFAULT_STAGED_CONFIG, progressive: false },

  shouldCompress(ctx: ContextCompressContext<StagedCompressConfig>): boolean {
    const tokens = ctx.knownTokens != null && ctx.knownTokens > 0 ? ctx.knownTokens : 0;
    if (tokens <= 0) return false;
    return tokens >= Math.floor((ctx.maxTokens * ctx.config.compactTriggerPercent) / 100);
  },

  async compress(ctx: ContextCompressContext<StagedCompressConfig>): Promise<ContextModuleResult> {
    const tokens =
      ctx.knownTokens != null && ctx.knownTokens > 0 ? ctx.knownTokens : 0;
    const required = requiredStage(
      ctx.maxTokens > 0 ? tokens / ctx.maxTokens : 0,
      ctx.config,
    );

    if (!ctx.force && required === "activeStage") {
      return idle(ctx.history, tokens);
    }

    const target = ctx.config.progressive && !ctx.force
      ? nextStage(ctx.currentStage, required === "activeStage" ? "compactStage" : required)
      : required === "activeStage"
        ? "compactStage"
        : required;

    const maxStage = ctx.config.progressive ? target : undefined;
    const retainRatio = ctx.config.retainTailRatio > 0 ? ctx.config.retainTailRatio : 0.16;
    const result = await compressMaou(ctx.history, {
      maxTokens: ctx.maxTokens,
      summarizer: ctx.summarizer,
      sessionId: ctx.sessionId,
      maxStage,
      fold: ctx.fold,
      knownTokens: tokens,
      force: ctx.force,
      retainCount: ctx.force
        ? 1
        : Math.max(1, Math.floor(ctx.history.length * retainRatio)),
      microTurn: ctx.microTurn,
      microCatalog: ctx.microCatalog,
      microRounds: ctx.microRounds,
      sessionRoot: ctx.sessionRoot,
      foldStage: ctx.foldStage,
      majorScheme: ctx.majorScheme ?? ctx.config.majorScheme,
    });

    return {
      compressed: result.stage !== "activeStage",
      stage: result.stage,
      history: result.history,
      droppedSummary: result.droppedSummary,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      blockIds: result.blockIds,
      foldedOriginals: result.foldedOriginals,
    };
  },
};
