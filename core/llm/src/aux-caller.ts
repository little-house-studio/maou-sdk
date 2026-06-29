/**
 * 辅助模型调用器（AuxModelCaller）—— 统一辅助模型调用接口
 *
 * 设计目标：
 *   - 主模型 vs 辅助模型分离：主模型用于 agent 主循环，辅助模型用于压缩/判定/路由等小任务
 *   - 统一调用管道：所有辅助调用走同一条路径（重试/日志/计费），不再各写各的
 *   - 独立 token 记录：辅助调用的 token 单独统计，不混入主调用的 round 0
 *   - 可配置 fallback：辅助模型不可用时回退主模型 preset，再回退确定性算法
 *
 * 对比 ModelCaller：
 *   - ModelCaller 面向主循环：流式、toolSchemas、JSON 校验、复杂重试
 *   - AuxModelCaller 面向辅助调用：非流式、无工具、简单重试、独立计费
 *
 * 用法：
 *   const aux = new AuxModelCaller({ client: llmClient, tag: "compressor" });
 *   const text = await aux.callText({ preset, systemPrompt, userPrompt });
 *   const json = await aux.callJson({ preset, systemPrompt, userPrompt, schema });
 */

import type { LLMClient } from "./client.js";
import type { APIPreset, LLMUsage } from "./adapters/types.js";

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 辅助模型调用参数 */
export interface AuxCallParams {
  /** 模型 preset（辅助模型或主模型） */
  preset: APIPreset;
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户输入 */
  userPrompt: string;
  /** 中断信号 */
  abortSignal?: AbortSignal;
  /** 调用上下文（用于日志标记） */
  context?: {
    sessionId?: string;
    tag?: string; // 如 "compressor" / "loop_judge" / "task_router"
  };
}

/** 辅助模型调用结果（文本） */
export interface AuxCallResult {
  /** 模型返回的文本内容 */
  content: string;
  /** token 用量（独立统计，不混入主调用） */
  usage: LLMUsage | null;
  /** 调用是否成功 */
  ok: boolean;
  /** 失败时的错误信息 */
  error?: string;
  /** 实际使用的 preset 名称（fallback 时可能不同于传入的 preset） */
  presetName: string;
}

/** 辅助模型调用结果（JSON） */
export interface AuxJsonCallResult extends AuxCallResult {
  /** 解析后的 JSON 对象（解析失败为 null） */
  json: Record<string, unknown> | null;
}

/** 辅助模型用量统计 */
export interface AuxUsageStats {
  /** 总调用次数 */
  calls: number;
  /** 成功次数 */
  ok: number;
  /** 失败次数 */
  failed: number;
  /** 累计 input tokens */
  totalInputTokens: number;
  /** 累计 output tokens */
  totalOutputTokens: number;
  /** 按 tag 分组的统计 */
  byTag: Map<string, { calls: number; ok: number; failed: number; tokens: number }>;
}

// ─── AuxModelCaller ────────────────────────────────────────────────────────

/**
 * 辅助模型调用器
 *
 * 与 ModelCaller 的区别：
 *   - 非流式（辅助调用不需要流式输出）
 *   - 无工具调用（辅助调用只做判断/生成文本）
 *   - 独立 token 统计（不混入主调用的 TokenTracker）
 *   - 简单重试（最多 1 次重试，不像主调用那样复杂）
 */
export class AuxModelCaller {
  private client: LLMClient;
  private maxRetries: number;
  /** 用量统计（按 tag 分组） */
  private stats: AuxUsageStats = {
    calls: 0,
    ok: 0,
    failed: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byTag: new Map(),
  };

  constructor(params: {
    client: LLMClient;
    maxRetries?: number;
  }) {
    this.client = params.client;
    this.maxRetries = params.maxRetries ?? 1;
  }

  /**
   * 调用辅助模型，返回文本
   *
   * 内置 fallback：
   *   - 第一次用传入的 preset 调用
   *   - 失败时若提供了 fallbackPreset，用 fallbackPreset 重试一次
   *   - 都失败则返回 { ok: false, content: "" }
   */
  async callText(
    params: AuxCallParams,
    fallbackPreset?: APIPreset,
  ): Promise<AuxCallResult> {
    const tag = params.context?.tag ?? "aux";
    const presets = fallbackPreset ? [params.preset, fallbackPreset] : [params.preset];

    let lastError: string | undefined;
    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i]!;
      try {
        const resp = await this._callWithRetry(preset, params.systemPrompt, params.userPrompt, params.abortSignal);
        const content = String(resp.content ?? "").trim();
        const usage = resp.usage ?? null;

        // 统计
        this._recordStats(tag, true, usage);

        return {
          content,
          usage,
          ok: true,
          presetName: String(preset.name ?? preset.model ?? "?"),
        };
      } catch (err) {
        lastError = String(err).slice(0, 200);
        // 继续尝试下一个 preset（fallback）
      }
    }

    // 全部失败
    this._recordStats(tag, false, null);
    return {
      content: "",
      usage: null,
      ok: false,
      error: lastError,
      presetName: String(params.preset.name ?? params.preset.model ?? "?"),
    };
  }

  /**
   * 调用辅助模型，返回 JSON 对象
   *
   * 从模型输出中提取第一个 JSON 对象（`{...}`），解析失败返回 json: null
   */
  async callJson(
    params: AuxCallParams,
    fallbackPreset?: APIPreset,
  ): Promise<AuxJsonCallResult> {
    const result = await this.callText(params, fallbackPreset);
    if (!result.ok || !result.content) {
      return { ...result, json: null };
    }

    // 从文本中提取 JSON
    const m = result.content.match(/\{[\s\S]*\}/);
    if (!m) {
      return { ...result, json: null, error: "JSON 解析失败：未找到 JSON 对象" };
    }
    try {
      const json = JSON.parse(m[0]) as Record<string, unknown>;
      return { ...result, json };
    } catch (err) {
      return { ...result, json: null, error: `JSON 解析失败：${String(err).slice(0, 100)}` };
    }
  }

  /** 获取用量统计 */
  getStats(): Readonly<AuxUsageStats> {
    return this.stats;
  }

  /** 重置用量统计 */
  resetStats(): void {
    this.stats = {
      calls: 0,
      ok: 0,
      failed: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byTag: new Map(),
    };
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────

  private async _callWithRetry(
    preset: APIPreset,
    systemPrompt: string,
    userPrompt: string,
    abortSignal?: AbortSignal,
  ): Promise<{ content: string; usage: LLMUsage | null }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const resp = await this.client.chat({
          preset,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          abortSignal,
        });
        return {
          content: String(resp.content ?? ""),
          usage: resp.usage ?? null,
        };
      } catch (err) {
        lastErr = err;
        // 最后一次尝试不再等待
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  }

  private _recordStats(tag: string, ok: boolean, usage: LLMUsage | null): void {
    this.stats.calls++;
    if (ok) this.stats.ok++;
    else this.stats.failed++;

    if (usage) {
      this.stats.totalInputTokens += Number(usage.input_tokens ?? 0);
      this.stats.totalOutputTokens += Number(usage.output_tokens ?? 0);
    }

    const tagStats = this.stats.byTag.get(tag) ?? { calls: 0, ok: 0, failed: 0, tokens: 0 };
    tagStats.calls++;
    if (ok) tagStats.ok++;
    else tagStats.failed++;
    tagStats.tokens += Number(usage?.input_tokens ?? 0) + Number(usage?.output_tokens ?? 0);
    this.stats.byTag.set(tag, tagStats);
  }
}

// ─── 辅助：从 APIPreset 数组中选择辅助模型 preset ──────────────────────────

/**
 * 辅助模型 preset 解析
 *
 * 优先级链：
 *   1. agent.json 的 helperModel（字符串，匹配 preset name）
 *   2. 全局 helperPreset（config.api.helperPreset 索引）
 *   3. 回退主模型 preset
 *
 * @param agentHelperModel - agent.json 中的 helperModel 字段（可选）
 * @param presets - 全局 presets 数组
 * @param helperPresetIdx - 全局 helperPreset 索引（可选）
 * @param mainPreset - 主模型 preset（必填，作为 fallback）
 */
export function resolveHelperPreset(
  agentHelperModel: string | undefined,
  presets: APIPreset[],
  helperPresetIdx: number | undefined,
  mainPreset: APIPreset,
): APIPreset {
  // 1. agent.json helperModel 优先
  if (agentHelperModel) {
    const found = presets.find(
      (p) => p.name === agentHelperModel || p.model === agentHelperModel,
    );
    if (found) return found;
  }

  // 2. 全局 helperPreset 索引
  if (typeof helperPresetIdx === "number" && helperPresetIdx >= 0 && helperPresetIdx < presets.length) {
    return presets[helperPresetIdx]!;
  }

  // 3. 回退主模型
  return mainPreset;
}
