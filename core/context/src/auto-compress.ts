/**
 * 自动压缩宿主：按模块 id 调度，不内嵌压法。
 */

import type { MaouMessage } from "./types/message.js";
import type { CompressionStage } from "./types/compression.js";
import type { Summarizer } from "./compressor.js";
import { estimateTokens } from "./token-estimate.js";
import {
  DEFAULT_LEGACY_CONFIG,
  DEFAULT_STAGED_CONFIG,
  resolveContextModule,
  type ContextCompressContext,
  type ContextModule,
  type ContextModuleResult,
  type LegacyCompressConfig,
  type StagedCompressConfig,
} from "./modules/index.js";

export type { LegacyCompressConfig, StagedCompressConfig, SummaryModelConfig } from "./modules/index.js";
export { DEFAULT_LEGACY_CONFIG, DEFAULT_STAGED_CONFIG, DEFAULT_SUMMARIZER_PROMPT } from "./modules/index.js";

/** 模块 id。内置：legacy / staged。 */
export type CompressMode = string;

export interface AutoCompressConfig {
  enabled: boolean;
  maxTokens: number;
  /** 上下文模块 id（默认 staged） */
  mode: CompressMode;
  summarizer?: Summarizer;
  sessionId?: string;
  legacy: LegacyCompressConfig;
  staged: StagedCompressConfig;
  /** 自定义模块的配置，按 id 取 */
  modules?: Record<string, unknown>;
}

export const DEFAULT_AUTO_COMPRESS_CONFIG: AutoCompressConfig = {
  enabled: true,
  maxTokens: 65536,
  mode: "staged",
  legacy: DEFAULT_LEGACY_CONFIG,
  staged: DEFAULT_STAGED_CONFIG,
};

export function resolveAutoCompressConfig(
  partial?: Partial<AutoCompressConfig>,
): AutoCompressConfig {
  if (!partial) return { ...DEFAULT_AUTO_COMPRESS_CONFIG };
  return {
    ...DEFAULT_AUTO_COMPRESS_CONFIG,
    ...partial,
    legacy: { ...DEFAULT_LEGACY_CONFIG, ...partial.legacy },
    staged: { ...DEFAULT_STAGED_CONFIG, ...partial.staged },
    modules: partial.modules
      ? { ...DEFAULT_AUTO_COMPRESS_CONFIG.modules, ...partial.modules }
      : DEFAULT_AUTO_COMPRESS_CONFIG.modules,
  };
}

export type AutoCompressResult = ContextModuleResult & { mode: CompressMode };

export interface CompressPolicy {
  shouldCompress(history: MaouMessage[], config: AutoCompressConfig): boolean;
}

export function moduleConfigFor(config: AutoCompressConfig, id: string): unknown {
  if (config.modules?.[id] != null) return config.modules[id];
  const named: Record<string, unknown> = {
    legacy: config.legacy,
    staged: config.staged,
  };
  if (named[id] != null) return named[id];
  return resolveContextModule(id).defaultConfig ?? {};
}

export function toModuleContext(
  history: MaouMessage[],
  config: AutoCompressConfig,
  currentStage: CompressionStage,
  extras?: {
    force?: boolean;
    knownTokens?: number;
    activeTaskIds?: string[];
  },
): ContextCompressContext {
  return {
    history,
    maxTokens: config.maxTokens,
    summarizer: config.summarizer,
    sessionId: config.sessionId,
    currentStage,
    force: extras?.force,
    knownTokens: extras?.knownTokens,
    activeTaskIds: extras?.activeTaskIds,
    config: moduleConfigFor(config, config.mode),
  };
}

export class TokenThresholdPolicy implements CompressPolicy {
  shouldCompress(history: MaouMessage[], config: AutoCompressConfig): boolean {
    if (!config.enabled) return false;
    return resolveContextModule(config.mode).shouldCompress(
      toModuleContext(history, config, "activeStage"),
    );
  }
}

export class AutoCompressSession {
  private config: AutoCompressConfig;
  private policy: CompressPolicy;
  private module: ContextModule;
  private history: MaouMessage[] = [];
  private dirty = false;
  private currentStage: CompressionStage = "activeStage";
  private rollingSummary = "";
  private lastCompressResult: AutoCompressResult | null = null;

  constructor(config?: Partial<AutoCompressConfig>, policy?: CompressPolicy) {
    this.config = resolveAutoCompressConfig(config);
    this.policy = policy ?? new TokenThresholdPolicy();
    this.module = resolveContextModule(this.config.mode);
  }

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
    return this.doCompress(true);
  }

  updateConfig(partial: Partial<AutoCompressConfig>): void {
    Object.assign(this.config, partial);
    if (partial.legacy) Object.assign(this.config.legacy, partial.legacy);
    if (partial.staged) Object.assign(this.config.staged, partial.staged);
    if (partial.modules) {
      this.config.modules = { ...this.config.modules, ...partial.modules };
    }
    if (partial.mode) this.module = resolveContextModule(this.config.mode);
  }

  reset(): void {
    this.history = [];
    this.dirty = false;
    this.currentStage = "activeStage";
    this.rollingSummary = "";
    this.lastCompressResult = null;
  }

  private async maybeCompress(): Promise<void> {
    if (!this.dirty) return;
    if (!this.policy.shouldCompress(this.history, this.config)) return;
    await this.doCompress(false);
    this.dirty = false;
  }

  private async doCompress(force: boolean): Promise<AutoCompressResult> {
    this.module = resolveContextModule(this.config.mode);
    const raw = await this.module.compress(
      toModuleContext(this.history, this.config, this.currentStage, { force }),
    );
    const result: AutoCompressResult = { ...raw, mode: this.config.mode };

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
