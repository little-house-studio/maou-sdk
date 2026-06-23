/**
 * 上下文层类型定义。
 */

import type { SessionData } from "./session-store.js";
import type { CompressionZone } from "./types/compression.js";

// ─── Harness 层消息结构体 ────────────────────────────────────────

export type {
  HarnessContent,
  HarnessMessage,
  TaskBlock,
  LLMMessage,
  LLMToolCall,
} from "./types/message.js";

// ─── 压缩区域类型 ────────────────────────────────────────────────

export type {
  CompressionZone,
  CompressionConfig,
  MicroCompactConfig,
  CompressionResult,
  TaskSummary,
} from "./types/compression.js";

// ─── 基础上下文类型 ────────────────────────────────────────────────

/** 插入在 system 和用户消息之间的三层 user 消息选项 */
export interface UserMessageOptions {
  /** BEFORE_USER.md 编译内容 */
  beforeUserContent?: string;
  /** 动态注入内容（board/pending/agents 状态） */
  dynamicInjections?: string;
  /** 用户消息原文 */
  userMessage?: string;
  /** 用户身份名称 */
  userName?: string;
  /** system 前区注入（位于 System.md 之前） */
  systemPre?: string;
  /** system 后区注入（位于 System.md 之后） */
  systemPost?: string;
  /** 烘焙上下文区（用户偏好、项目信息等） */
  bakedContext?: string;
  /** 压缩区摘要（来自 maybeCompress 的 droppedSummary） */
  compressedSummary?: string;
}

/** 消息构建参数 */
export interface BuildMessagesParams {
  systemPrompt: string;
  sessionMessages: SessionData["messages"];
  roundCount: number;
  currentRound: number;
  userOpts?: UserMessageOptions;
  platformContext?: string;
  rollingSummary?: string;
  /** 结构化记忆上下文（从 MemoryStore recall 生成） */
  structuredMemory?: string;
  /** 项目根目录（用于加载 .maou/context/） */
  projectRoot?: string;
}

/** 压缩结果 */
export interface CompressResult {
  messages: Record<string, unknown>[];
  compressed: boolean;
  droppedSummary: string;
  /** 本轮实际到达的压缩区域（active/compact/summary/archive） */
  zone: CompressionZone;
  /** 压缩前估算 token */
  originalTokens: number;
  /** 压缩后估算 token */
  compressedTokens: number;
  /** 大压缩/归档时产出的任务块 ID 列表 */
  taskBlocks?: string[];
}

/** 上下文构建器—用于构建发送给 LLM 的完整消息数组 */
export interface ContextBuilder {
  /** 构建消息数组 */
  buildMessages(params: BuildMessagesParams): Record<string, unknown>[];
  /** 压缩上下文 */
  maybeCompress(messages: Record<string, unknown>[], maxTokens: number): CompressResult;
}

// ─── 优先级 ──────────────────────────────────────────────

/**
 * @deprecated v1 遗留。新压缩算法按 zone 决策，不再依赖优先级。保留以避免破坏外部引用。
 */
export type MessagePriority = "critical" | "important" | "normal";

/**
 * @deprecated v1 遗留，见 MessagePriority。
 */
export interface PriorityConfig {
  /** 永不丢弃的优先级等级 */
  neverDrop: MessagePriority;
  /** 最后才丢弃的优先级等级 */
  dropLast: MessagePriority;
  /** 是否尊重 pinned 标记 */
  respectPinned: boolean;
}


// ─── 多会话管理 ──────────────────────────────────────────

/** 活跃会话状态 */
export interface ActiveSession {
  sessionId: string;
  agentName: string;
  status: "active" | "paused" | "completed";
  pausedAt?: string;
  rollingSummary?: string;
}

/** 会话切换结果 */
export interface SwitchResult {
  previousSession: ActiveSession;
  newSession: ActiveSession;
}

// ─── 结构化记忆 ──────────────────────────────────────────

/** 记忆条目 */
export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  category: string;
  tags: string[];
  sourceSessionId: string;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
}

/** 记忆召回结果 */
export interface MemoryRecallResult {
  memories: MemoryEntry[];
  formattedContext: string;
}

/** 记忆提取结果（未持久化前） */
export interface ExtractedMemory {
  key: string;
  value: string;
  category: string;
  tags: string[];
}

// ─── 会话快照 ────────────────────────────────────────────

/** 快照元信息 */
export interface CheckpointMeta {
  id: string;
  sessionId: string;
  label: string;
  messageCount: number;
  createdAt: string;
  autoCheckpoint: boolean;
  triggerReason?: string;
}

/** 快照差异 */
export interface CheckpointDiff {
  addedMessages: number;
  removedMessages: number;
  addedTraces: number;
  removedTraces: number;
  messageSnippets: string[];
}
