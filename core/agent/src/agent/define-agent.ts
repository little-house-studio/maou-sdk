/**
 * defineAgent — 文件即 Agent 定义 API（对标 Vercel Eve）
 *
 * 用法：在 agent/agent.ts 中导出 defineAgent() 的返回值。
 *
 * @example
 * // agent/agent.ts
 * import { defineAgent } from "@little-house-studio/agent/define";
 *
 * export default defineAgent({
 *   model: "anthropic/claude-sonnet-4.6",
 *   maxSteps: 50,
 *   compaction: { threshold: 0.7, preserveToolCalls: true },
 * });
 */

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 模型回退配置 */
export interface ModelFallback {
  /** 主模型 */
  primary: string;
  /** 回退模型列表（主模型不可用时按序尝试） */
  fallbacks?: string[];
}

/** 上下文压缩配置 */
export interface CompactionConfig {
  /** 压缩触发阈值（0-1，token 使用量占 maxContext 的比例），默认 0.7 */
  threshold?: number;
  /** 压缩时是否保留完整的 tool call 链，默认 true */
  preserveToolCalls?: boolean;
  /** 压缩时保留的最近消息条数，默认 4 */
  preserveRecentCount?: number;
}

/** defineAgent 配置 */
export interface DefineAgentConfig {
  /** 模型标识，格式："provider/model"（如 "anthropic/claude-sonnet-4.6"） */
  model: string | ModelFallback;

  /** 辅助模型标识（可选）—— 用于压缩/loop判定/路由等辅助调用。
   * 字符串匹配 preset name 或 model id；未配置时回退主模型。
   * 优先级：agent.json helperModel > 全局 helperPreset > 主模型 preset
   */
  helperModel?: string;

  /** Agent 显示名称（可选，默认用目录名） */
  name?: string;

  /** Agent 描述（可选，用于子 Agent 场景的描述） */
  description?: string;

  /** 最大步数（0 = 无限），默认 0 */
  maxSteps?: number;

  /** 上下文压缩配置 */
  compaction?: CompactionConfig;

  /** 工具白名单（可选，["*"] = 全部可用） */
  tools?: string[];

  /** Agent 轮次上限（0 = 无限） */
  roundLimit?: number;

  /** 是否启用沙箱（默认 false） */
  sandbox?: boolean;

  /** 沙箱配置 */
  sandboxConfig?: Record<string, unknown>;

  /** 额外的模型参数 */
  modelOptions?: Record<string, unknown>;
}

// ─── DefinedAgent 结果 ─────────────────────────────────────────────────────

/**
 * defineAgent 返回的 Agent 定义对象
 * 可被 AgentRegistry 识别和加载
 */
export interface DefinedAgent {
  /** 配置来源 */
  readonly _type: "defineAgent";
  readonly _source: "file";

  /** 模型配置 */
  model: string | ModelFallback;

  /** 辅助模型配置（可选） */
  helperModel?: string;

  /** 显示名称 */
  name?: string;

  /** 描述 */
  description?: string;

  /** 最大步数 */
  maxSteps: number;

  /** 压缩配置 */
  compaction: CompactionConfig;

  /** 工具白名单 */
  tools: string[];

  /** 轮次上限 */
  roundLimit: number;

  /** 沙箱 */
  sandbox: boolean;

  /** 沙箱配置 */
  sandboxConfig: Record<string, unknown>;

  /** 模型参数 */
  modelOptions: Record<string, unknown>;

  /**
   * 转换为 AgentEntry 格式（兼容现有 AgentRegistry）
   */
  toAgentEntry(dirName: string): Record<string, unknown>;
}

// ─── defineAgent 函数 ──────────────────────────────────────────────────────

/**
 * 定义一个 Agent（文件即 Agent 约定的核心 API）
 *
 * @param config - Agent 配置
 * @returns DefinedAgent 实例
 *
 * @example
 * export default defineAgent({
 *   model: "anthropic/claude-sonnet-4.6",
 *   maxSteps: 50,
 *   compaction: { threshold: 0.7 },
 * });
 */
export function defineAgent(config: DefineAgentConfig): DefinedAgent {
  return {
    _type: "defineAgent",
    _source: "file",

    model: config.model,
    helperModel: config.helperModel,
    name: config.name,
    description: config.description,
    maxSteps: config.maxSteps ?? 0,
    compaction: {
      threshold: config.compaction?.threshold ?? 0.7,
      preserveToolCalls: config.compaction?.preserveToolCalls ?? true,
      preserveRecentCount: config.compaction?.preserveRecentCount ?? 4,
    },
    tools: config.tools ?? ["*"],
    roundLimit: config.roundLimit ?? 0,
    sandbox: config.sandbox ?? false,
    sandboxConfig: config.sandboxConfig ?? {},
    modelOptions: config.modelOptions ?? {},

    toAgentEntry(dirName: string): Record<string, unknown> {
      const modelStr = typeof config.model === "string"
        ? config.model
        : config.model.primary;

      return {
        name: config.name || dirName,
        display_name: config.name || dirName,
        status: "idle",
        role: "",
        team: "",
        parent: "",
        personality: "",
        scope: "",
        description: config.description || "",
        notes: "",
        created_by: "",
        created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
        updated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
        model: modelStr,
        helperModel: config.helperModel,
        tools: config.tools ?? ["*"],
        round_limit: config.roundLimit ?? 0,
        _defineAgent: true,
        _compaction: config.compaction,
        _maxSteps: config.maxSteps,
        _sandbox: config.sandbox,
        _sandboxConfig: config.sandboxConfig,
        _modelOptions: config.modelOptions,
      };
    },
  };
}
