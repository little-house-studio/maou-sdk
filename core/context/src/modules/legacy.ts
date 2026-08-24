/**
 * 传统压缩模块：过阈值后留下最近 N 轮，更早的换成一条摘要。
 */

import { estimateTokens } from "../token-estimate.js";
import { maouToLLMMessage, type MaouMessage } from "../types/message.js";
import type {
  ContextCompressContext,
  ContextModule,
  ContextModuleResult,
  SummaryModelConfig,
} from "./types.js";
import { DEFAULT_SUMMARIZER_PROMPT } from "./types.js";

export interface LegacyCompressConfig {
  triggerPercent: number;
  keepRecentRounds: number;
  summarizerPrompt: string;
  summaryModel: SummaryModelConfig;
}

export const DEFAULT_LEGACY_CONFIG: LegacyCompressConfig = {
  triggerPercent: 80,
  keepRecentRounds: 3,
  summarizerPrompt: DEFAULT_SUMMARIZER_PROMPT,
  summaryModel: {},
};

function idle(history: MaouMessage[], tokens: number): ContextModuleResult {
  return {
    compressed: false,
    stage: "activeStage",
    history,
    droppedSummary: "",
    originalTokens: tokens,
    compressedTokens: tokens,
    taskBlocks: [],
  };
}

function findRecentRoundsBoundary(history: MaouMessage[], keepRounds: number): number {
  let rounds = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].category === "user") {
      rounds++;
      if (rounds >= keepRounds) return i;
    }
  }
  return 0;
}

function makeSummaryMsg(summary: string): MaouMessage {
  return {
    seqId: -1,
    taskIds: [],
    category: "compact",
    contents: [{ text: summary }],
    keepAfterCompress: true,
    createdAt: new Date().toISOString(),
  };
}

function fallbackSummary(msgs: MaouMessage[]): string {
  const lines: string[] = [];
  for (const m of msgs) {
    const text = m.contents.map((c) => c.text).join(" ");
    lines.push(`[${m.category}] ${text.slice(0, 80)}`);
  }
  return lines.join("\n");
}

export const legacyContextModule: ContextModule<LegacyCompressConfig> = {
  id: "legacy",
  defaultConfig: DEFAULT_LEGACY_CONFIG,

  shouldCompress(ctx: ContextCompressContext<LegacyCompressConfig>): boolean {
    const tokens = estimateTokens(ctx.history);
    const pct = ctx.config.triggerPercent;
    return tokens >= Math.floor((ctx.maxTokens * pct) / 100);
  },

  async compress(ctx: ContextCompressContext<LegacyCompressConfig>): Promise<ContextModuleResult> {
    const originalTokens = estimateTokens(ctx.history);
    if (!ctx.force && !this.shouldCompress(ctx)) {
      return idle(ctx.history, originalTokens);
    }

    const boundary = findRecentRoundsBoundary(ctx.history, ctx.config.keepRecentRounds);
    const recent = ctx.history.slice(boundary);
    const old = ctx.history.slice(0, boundary);
    if (old.length === 0) return idle(ctx.history, originalTokens);

    let summary: string;
    if (ctx.summarizer) {
      try {
        summary = await ctx.summarizer({
          kind: "task",
          messages: old.map(maouToLLMMessage),
          prompt: ctx.config.summarizerPrompt,
        });
      } catch {
        summary = fallbackSummary(old);
      }
    } else {
      summary = fallbackSummary(old);
    }

    const history = [makeSummaryMsg(summary), ...recent];
    return {
      compressed: true,
      stage: "summaryStage",
      history,
      droppedSummary: summary,
      originalTokens,
      compressedTokens: estimateTokens(history),
      taskBlocks: [],
    };
  },
};
