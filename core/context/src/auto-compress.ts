/**
 * 自动压缩 —— 两种模式 + 配置 + 会话封装
 *
 * 模式一：传统模式（Claude Code 风格）
 *   超过阈值 → 保留最近 X 轮原始内容 → 剩下的用 LLM 生成摘要替换
 *   特点：简单粗暴，一次到位
 *
 * 模式二：分段模式（渐进式）
 *   微压缩（滑动窗口，无需 LLM）→ 大压缩（LLM 摘要）→ 归档（极简标签）
 *   特点：逐级递进，每轮只压一级
 *
 * 共有配置：
 *   enabled, maxTokens, triggerPercent, summarizer, summarizerPrompt, summaryModel
 */

import type { MaouMessage } from "./types/message.js";
import type { CompressionStage } from "./types/compression.js";
import type { Summarizer } from "./compressor.js";
import { compressMaou } from "./compressor.js";
import { maouToLLMMessage } from "./types/message.js";
import { estimateTokens } from "./token-estimate.js";

// ─── 默认摘要提示词（放在最前面，被 DEFAULT_LEGACY_CONFIG / DEFAULT_STAGED_CONFIG 引用） ──

export const DEFAULT_SUMMARIZER_PROMPT = `你的任务是为对话历史生成结构化摘要，保留以下关键信息：
1. 用户的明确请求和意图
2. AI 的关键决策和操作
3. 重要的技术细节（文件名、代码片段、配置值）
4. 遇到的错误和修复方式
5. 用户给出的反馈和纠正

摘要应该简洁但完整，让 AI 能从摘要中恢复上下文继续工作。`;

// ─── LLM 摘要模型配置 ──────────────────────────────────────────────────────

/** 摘要用 LLM 模型配置（默认和主 LLM 一致） */
export interface SummaryModelConfig {
  /** 模型名称（默认和主 LLM 相同） */
  model?: string;
  /** API base URL（默认和主 LLM 相同） */
  baseUrl?: string;
  /** API key（默认和主 LLM 相同） */
  apiKey?: string;
  /** 最大输出 token（默认 4096） */
  maxOutputTokens?: number;
}

// ─── 传统模式配置 ──────────────────────────────────────────────────────────

/** 传统压缩模式配置（Claude Code 风格） */
export interface LegacyCompressConfig {
  /** 触发阈值：token 占 maxTokens 的百分比（默认 80） */
  triggerPercent: number;
  /** 保留最近 X 轮对话的原始内容（默认 3） */
  keepRecentRounds: number;
  /** LLM 摘要提示词 */
  summarizerPrompt: string;
  /** 摘要模型配置（默认和主 LLM 相同） */
  summaryModel: SummaryModelConfig;
}

export const DEFAULT_LEGACY_CONFIG: LegacyCompressConfig = {
  triggerPercent: 80,
  keepRecentRounds: 3,
  summarizerPrompt: DEFAULT_SUMMARIZER_PROMPT,
  summaryModel: {},
};

// ─── 分段模式配置 ──────────────────────────────────────────────────────────

/** 分段压缩模式配置（渐进式） */
export interface StagedCompressConfig {
  /** 微压缩触发阈值（默认 70） */
  compactTriggerPercent: number;
  /** 大压缩触发阈值（默认 80） */
  summaryTriggerPercent: number;
  /** 归档触发阈值（默认 90） */
  archiveTriggerPercent: number;
  /** 微压缩动态区：保留最近消息的百分比（默认 40） */
  activeWindowPercent: number;
  /** 单条消息超过此字符数自动参与微压缩（默认 800） */
  microSingleMsgChars: number;
  /** LLM 摘要提示词 */
  summarizerPrompt: string;
  /** 摘要模型配置（默认和主 LLM 相同） */
  summaryModel: SummaryModelConfig;
  /** 是否逐级递进（默认 true：每轮只压一级） */
  progressive: boolean;
}

export const DEFAULT_STAGED_CONFIG: StagedCompressConfig = {
  compactTriggerPercent: 70,
  summaryTriggerPercent: 80,
  archiveTriggerPercent: 90,
  activeWindowPercent: 40,
  microSingleMsgChars: 800,
  summarizerPrompt: DEFAULT_SUMMARIZER_PROMPT,
  summaryModel: {},
  progressive: true,
};

// ─── 总配置 ────────────────────────────────────────────────────────────────

/** 压缩模式 */
export type CompressMode = "legacy" | "staged";

/** 自动压缩总配置 */
export interface AutoCompressConfig {
  /** 是否开启自动压缩（默认 true） */
  enabled: boolean;
  /** 最大 token 预算（默认 65536） */
  maxTokens: number;
  /** 压缩模式（默认 "staged"） */
  mode: CompressMode;
  /** LLM 摘要器（可选，提供则忽略 summaryModel） */
  summarizer?: Summarizer;
  /** 会话 ID（持久化用） */
  sessionId?: string;
  /** 传统模式配置 */
  legacy: LegacyCompressConfig;
  /** 分段模式配置 */
  staged: StagedCompressConfig;
}

export const DEFAULT_AUTO_COMPRESS_CONFIG: AutoCompressConfig = {
  enabled: true,
  maxTokens: 65536,
  mode: "staged",
  legacy: DEFAULT_LEGACY_CONFIG,
  staged: DEFAULT_STAGED_CONFIG,
};

/** 从部分配置补全为完整配置 */
export function resolveAutoCompressConfig(
  partial?: Partial<AutoCompressConfig>,
): AutoCompressConfig {
  if (!partial) return { ...DEFAULT_AUTO_COMPRESS_CONFIG };
  return {
    ...DEFAULT_AUTO_COMPRESS_CONFIG,
    ...partial,
    legacy: { ...DEFAULT_LEGACY_CONFIG, ...partial.legacy },
    staged: { ...DEFAULT_STAGED_CONFIG, ...partial.staged },
  };
}

// ─── 压缩结果 ──────────────────────────────────────────────────────────────

/** 压缩执行结果 */
export interface AutoCompressResult {
  /** 是否执行了压缩 */
  compressed: boolean;
  /** 当前阶段（分段模式用） */
  stage: CompressionStage;
  /** 压缩模式 */
  mode: CompressMode;
  /** 压缩后的历史 */
  history: MaouMessage[];
  /** 压缩摘要（注入 beforeUser 用） */
  droppedSummary: string;
  /** 压缩前 token */
  originalTokens: number;
  /** 压缩后 token */
  compressedTokens: number;
  /** 产出的任务块 ID（分段模式用） */
  taskBlocks: string[];
}

// ─── 压缩策略接口 ──────────────────────────────────────────────────────────

/** 压缩策略接口 */
export interface CompressPolicy {
  /** 是否需要压缩 */
  shouldCompress(history: MaouMessage[], config: AutoCompressConfig): boolean;
}

// ─── 传统模式执行 ──────────────────────────────────────────────────────────

/**
 * 传统压缩：超过阈值 → 保留最近 X 轮 → 剩下的用 LLM 生成摘要
 *
 * 流程：
 *   1. 检查 token 是否超过阈值
 *   2. 从最新往前数 X 轮，保留原始内容
 *   3. 剩余的旧消息全部用 LLM 生成一条摘要消息替换
 */
async function legacyCompress(
  history: MaouMessage[],
  config: AutoCompressConfig,
): Promise<AutoCompressResult> {
  const originalTokens = estimateTokens(history);
  const threshold = Math.floor(
    (config.maxTokens * config.legacy.triggerPercent) / 100,
  );

  if (originalTokens < threshold) {
    return {
      compressed: false,
      stage: "activeStage",
      mode: "legacy",
      history,
      droppedSummary: "",
      originalTokens,
      compressedTokens: originalTokens,
      taskBlocks: [],
    };
  }

  // 找到最近 X 轮的边界
  const keepRounds = config.legacy.keepRecentRounds;
  const boundary = findRecentRoundsBoundary(history, keepRounds);

  // 保留部分：boundary 之后的消息
  const recent = history.slice(boundary);
  // 压缩部分：boundary 之前的消息
  const old = history.slice(0, boundary);

  if (old.length === 0) {
    return {
      compressed: false,
      stage: "activeStage",
      mode: "legacy",
      history,
      droppedSummary: "",
      originalTokens,
      compressedTokens: originalTokens,
      taskBlocks: [],
    };
  }

  // 生成摘要
  let summary: string;
  const summarizer = config.summarizer;
  if (summarizer) {
    try {
      const llmMsgs = old.map(maouToLLMMessage);
      summary = await summarizer({ kind: "task", messages: llmMsgs });
    } catch {
      summary = fallbackSummary(old);
    }
  } else {
    summary = fallbackSummary(old);
  }

  // 构建摘要消息
  const summaryMsg = makeSummaryMsg(summary);
  const newHistory = [...recent];
  // 把摘要插到保留部分最前面
  newHistory.unshift(summaryMsg);

  const compressedTokens = estimateTokens(newHistory);

  return {
    compressed: true,
    stage: "summaryStage",
    mode: "legacy",
    history: newHistory,
    droppedSummary: summary,
    originalTokens,
    compressedTokens,
    taskBlocks: [],
  };
}

/** 找到最近 X 轮对话的起始边界 */
function findRecentRoundsBoundary(
  history: MaouMessage[],
  keepRounds: number,
): number {
  let rounds = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].category === "user") {
      rounds++;
      if (rounds >= keepRounds) return i;
    }
  }
  return 0;
}

// ─── 分段模式执行 ──────────────────────────────────────────────────────────

/**
 * 分段压缩：微压缩 → 大压缩 → 归档，逐级递进
 *
 * 微压缩：滑动窗口，从最新往前保留 N%，超出的旧消息按标注压缩（无需 LLM）
 * 大压缩：按 taskBlock 分组，LLM 生成摘要替换（需要 LLM）
 * 归档：只保留极简标签（taskBlock ID + 一句话摘要）
 */
async function stagedCompress(
  history: MaouMessage[],
  config: AutoCompressConfig,
  currentStage: CompressionStage,
): Promise<AutoCompressResult> {
  const tokens = estimateTokens(history);
  const staged = config.staged;

  // 计算当前 token 对应的最高阶段
  const ratio = tokens / config.maxTokens;
  let requiredStage: CompressionStage = "activeStage";
  if (ratio >= staged.archiveTriggerPercent / 100) requiredStage = "archiveStage";
  else if (ratio >= staged.summaryTriggerPercent / 100) requiredStage = "summaryStage";
  else if (ratio >= staged.compactTriggerPercent / 100) requiredStage = "compactStage";

  // 不需要压缩
  if (requiredStage === "activeStage") {
    return noChangeResult(history, tokens);
  }

  // 逐级递进：只升一级
  const targetStage = staged.progressive
    ? nextStage(currentStage, requiredStage)
    : requiredStage;

  const originalTokens = estimateTokens(history);
  const result = await compressMaou(history, {
    maxTokens: config.maxTokens,
    summarizer: config.summarizer,
    sessionId: config.sessionId,
    maxStage: targetStage,
  });

  return {
    compressed: originalTokens > result.compressedTokens,
    stage: result.stage,
    mode: "staged",
    history: result.history,
    droppedSummary: result.droppedSummary,
    originalTokens,
    compressedTokens: result.compressedTokens,
    taskBlocks: result.taskBlocks,
  };
}

/** 计算下一阶段（逐级递进） */
function nextStage(
  current: CompressionStage,
  required: CompressionStage,
): CompressionStage {
  const order: CompressionStage[] = [
    "activeStage", "compactStage", "summaryStage", "archiveStage",
  ];
  const ci = order.indexOf(current);
  const ri = order.indexOf(required);
  if (ri > ci) return order[ci + 1];
  return current;
}

function noChangeResult(
  history: MaouMessage[],
  tokens: number,
): AutoCompressResult {
  return {
    compressed: false,
    stage: "activeStage",
    mode: "staged",
    history,
    droppedSummary: "",
    originalTokens: tokens,
    compressedTokens: tokens,
    taskBlocks: [],
  };
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

function makeSummaryMsg(summary: string): MaouMessage {
  return {
    seqId: -1, // 系统分配
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
    const text = m.contents.map(c => c.text).join(" ");
    const preview = text.slice(0, 80);
    lines.push(`[${m.category}] ${preview}`);
  }
  return lines.join("\n");
}

// ─── 内置策略 ──────────────────────────────────────────────────────────────

/** Token 阈值策略（两种模式通用） */
export class TokenThresholdPolicy implements CompressPolicy {
  shouldCompress(history: MaouMessage[], config: AutoCompressConfig): boolean {
    if (!config.enabled) return false;
    const tokens = estimateTokens(history);
    const triggerPercent =
      config.mode === "legacy"
        ? config.legacy.triggerPercent
        : config.staged.compactTriggerPercent;
    const threshold = Math.floor(
      (config.maxTokens * triggerPercent) / 100,
    );
    return tokens >= threshold;
  }
}

// ─── AutoCompressSession ───────────────────────────────────────────────────

/**
 * 自动压缩会话
 *
 * 用法：
 *   // 分段模式（默认）
 *   const session = new AutoCompressSession({ mode: "staged" });
 *
 *   // 传统模式
 *   const session = new AutoCompressSession({ mode: "legacy", legacy: { keepRecentRounds: 5 } });
 *
 *   session.addMessage(userMsg);
 *   const messages = await session.getMessages(); // 自动检查+压缩
 */
export class AutoCompressSession {
  private config: AutoCompressConfig;
  private policy: CompressPolicy;
  private history: MaouMessage[] = [];
  private dirty = false;
  private currentStage: CompressionStage = "activeStage";
  private rollingSummary = "";
  private lastCompressResult: AutoCompressResult | null = null;

  constructor(
    config?: Partial<AutoCompressConfig>,
    policy?: CompressPolicy,
  ) {
    this.config = resolveAutoCompressConfig(config);
    this.policy = policy ?? new TokenThresholdPolicy();
  }

  // ── 公开接口 ──

  addMessage(msg: MaouMessage): void {
    this.history.push(msg);
    this.dirty = true;
  }

  addMessages(msgs: MaouMessage[]): void {
    this.history.push(...msgs);
    this.dirty = true;
  }

  async getMessages(): Promise<MaouMessage[]> {
    await this.maybeCompress();
    return this.history;
  }

  getRollingSummary(): string {
    return this.rollingSummary;
  }

  getCurrentStage(): CompressionStage {
    return this.currentStage;
  }

  getLastCompressResult(): AutoCompressResult | null {
    return this.lastCompressResult;
  }

  getCurrentTokens(): number {
    return estimateTokens(this.history);
  }

  getHistoryLength(): number {
    return this.history.length;
  }

  async forceCompress(): Promise<AutoCompressResult> {
    return this.doCompress();
  }

  updateConfig(partial: Partial<AutoCompressConfig>): void {
    Object.assign(this.config, partial);
    if (partial.legacy) Object.assign(this.config.legacy, partial.legacy);
    if (partial.staged) Object.assign(this.config.staged, partial.staged);
  }

  reset(): void {
    this.history = [];
    this.dirty = false;
    this.currentStage = "activeStage";
    this.rollingSummary = "";
    this.lastCompressResult = null;
  }

  // ── 内部逻辑 ──

  private async maybeCompress(): Promise<void> {
    if (!this.dirty) return;
    if (!this.policy.shouldCompress(this.history, this.config)) return;
    await this.doCompress();
    this.dirty = false;
  }

  private async doCompress(): Promise<AutoCompressResult> {
    const result =
      this.config.mode === "legacy"
        ? await legacyCompress(this.history, this.config)
        : await stagedCompress(this.history, this.config, this.currentStage);

    if (result.compressed) {
      this.history = result.history;
      this.rollingSummary = result.droppedSummary;
      if (result.stage !== this.currentStage) {
        this.currentStage = result.stage;
      }
    }

    this.lastCompressResult = result;
    return result;
  }
}
