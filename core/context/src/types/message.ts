/**
 * Maou 层消息结构体
 * 依赖 Context 层，用于灵活解析和压缩优化
 */

import type { SessionMessage } from "../session-store.js";
import { resolveSessionEventKind, isHumanTurnKind } from "../session-event.js";
import { contentWithThinkingForLlm } from "../thinking-context.js";

/**
 * 内容块
 */
export interface MaouContent {
  text: string;
  microCompact?: {
    enabled: boolean;
    summary?: string; // 微压缩后的摘要
  };
  break?: boolean;
}

/**
 * 消息块 - Maou 层使用的结构化消息
 * 支持 seqId 用于排序和追踪
 */
export interface MaouMessage {
  /** 系统分配的顺序ID，用于排序和追踪 */
  seqId: number;
  /** 所属任务ID数组 */
  taskIds: string[];
  /** 内容块数组（支持一条消息多个段，各段独立压缩配置） */
  contents: MaouContent[];
  /** 压缩后是否保留 */
  keepAfterCompress: boolean;
  /** 消息类别 */
  category: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'injected' | 'compact' | 'diff' | 'baked';
  /** 创建时间 (ISO string) */
  createdAt?: string;
  /** 是否固定 (压缩时永不丢弃) */
  pinned?: boolean;
  /** 原始 role (兼容 LLM API) */
  originalRole?: 'user' | 'assistant' | 'tool' | 'system';
  /** 工具调用 ID (tool_result 类别时使用) */
  toolCallId?: string;
  /** 工具调用列表 (tool_call 类别时使用) */
  toolCalls?: LLMToolCall[];
  /** 来源标识 */
  source?: string;
  /** 消息级元数据 */
  meta?: MessageMeta;
  /** 压缩消息（category='compact' 时使用） */
  compact?: CompactMessage;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 压缩消息 — 替换原始消息集群的产出物
 * 通过 sourceIds 可回溯到原始消息
 */
export interface CompactMessage {
  /** 压缩类型 */
  type: "micro" | "major" | "dead";
  /** 压缩后的摘要文本 */
  summary: string;
  /** 被压缩的原始消息 ID 列表（回溯用） */
  sourceIds: string[];
  /** 被压缩的原始范围（大压缩/死区用） */
  sourceRange?: { startId: string; endId: string };
  /** 死区指向的 task_block ID（可回溯完整内容） */
  taskBlockRef?: string;
}

/**
 * 消息级元数据 — 每条消息独有
 */
export interface MessageMeta {
  /** 消息顺序ID（系统自动分配） */
  magId: string;
  /** 消息角色 */
  role: "user" | "assistant" | "tool" | "system";
  /** 消息分类 */
  category: 'user' | 'ai' | 'tool_result' | 'compact' | 'diff' | 'baked' | 'system' | 'custom';
  /** 本条消息摘要（压缩时使用） */
  summary?: string;
  /** 微压缩配置 */
  microCompact: {
    /** 是否参与微压缩 */
    enabled: boolean;
    /** 压缩时怎么做 */
    action: "remove" | "replace" | "keep";
  };
  /** 上下文前缀（如系统注入的动态信息） */
  prefix?: {
    enabled: boolean;
    /** 微压缩时默认去掉前缀 */
    compactAction: "remove";
  };
}

/**
 * LLM 工具调用（LLM API 格式）
 * 与 core/tools/base.ts 的 ToolCall 区分：
 * - LLMToolCall: LLM API 返回的格式，使用 arguments 字段
 * - ToolCall: 内部工具系统格式，使用 parameters 字段
 */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * LLM 消息结构体 - 发送给 LLM API 的标准格式
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
}

/**
 * 任务状态
 */
export type TaskStatus = "pending" | "running" | "paused" | "done" | "failed" | "cancelled";

/**
 * 任务块 — 多条消息共享的任务级元数据
 *
 * 命名从原 taskMeta 改为 MaouTaskBlock，体现它是完整结构体而非仅元数据。
 */
export interface MaouTaskBlock {
  // ── 身份 ──
  /** 任务ID（AI分配，0号为普通对话） */
  taskId: string;
  /** 父任务ID（可选，支持子任务嵌套） */
  parentTaskId?: string;
  /** 任务状态 */
  status: TaskStatus;

  // ── 描述 ──
  /** 任务一句话摘要 */
  summary: string;
  /** 任务具体目标 */
  goal: string;
  /** 任务背景——为什么有这个任务 */
  background?: string;
  /** 任务流程大纲（不注入上下文，只在死区压缩时写入） */
  outline: string[];

  // ── 动态 ──
  /** 任务笔记/发现（before_user 中每轮显示，执行中持续积累） */
  notes?: string[];

  // ── 进度 ──
  /** 完成百分比 0~100 */
  progress?: number;
  /** 当前执行到哪一步 */
  currentStep?: string;

  // ── 关联 ──
  /** 依赖的其他任务ID（必须先完成才能开始） */
  dependencies?: string[];
  /** 任务期间工具自动 pin 下来的文件/网页路径（不注入上下文） */
  relatedFiles?: string[];
  /** AI 主动 pin 的重要引用片段 */
  pins?: Pin[];
  /** 标签（如 "bugfix", "feature", "refactor"） */
  tags?: string[];

  // ── 时间（系统自动填） ──
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  // ── 统计（系统自动填） ──
  /** 该任务下消息总数 */
  messageCount?: number;
  /** 工具调用次数 */
  toolCallCount?: number;
  /** 该任务消耗的 token */
  tokenUsage?: number;

  // ── 内容 ──
  /** 任务下的 llm_message 上下文数组（不记录子任务） */
  messages: LLMMessage[];
}

/** AI 主动 pin 的引用片段 */
export interface Pin {
  /** 文件路径 */
  path: string;
  /** 引用片段内容 */
  snippet: string;
  /** 为什么重要 */
  reason: string;
}

// ─── 转换函数 ─────────────────────────────────────────────────────────────

/**
 * Maou 注解持久化载体。
 * 存入 SessionMessage._maouMeta，恢复时无损回填到 MaouMessage。
 * 旧数据可能使用 _harness_meta 字段名，读取时通过 _maouMeta ?? _harness_meta 兼容。
 */
export interface MaouMeta {
  seqId: number;
  taskIds: string[];
  category: MaouMessage['category'];
  keepAfterCompress: boolean;
  /** 内容块的微压缩配置（按数组索引对应） */
  contentsMicroCompact?: Array<MaouContent['microCompact']>;
  meta?: MessageMeta;
  compact?: CompactMessage;
}

/**
 * 将 MaouMessage 转换为 LLMMessage 格式
 * 用于发送给 LLM API
 */
export function maouToLLMMessage(mmsg: MaouMessage): LLMMessage {
  let role: LLMMessage['role'];
  if (mmsg.originalRole) {
    role = mmsg.originalRole;
  } else {
    switch (mmsg.category) {
      case 'user':
      case 'injected':
      case 'diff':
      case 'baked':
      case 'compact':
        role = 'user';
        break;
      case 'assistant':
      case 'tool_call':
        role = 'assistant';
        break;
      case 'tool_result':
        role = 'tool';
        break;
      case 'system':
        role = 'system';
        break;
      default:
        role = 'user';
    }
  }

  // 拼接所有内容块（微压缩启用时用摘要）
  const contentParts: string[] = [];
  for (const c of mmsg.contents) {
    if (c.microCompact?.enabled && c.microCompact.summary) {
      contentParts.push(c.microCompact.summary);
    } else {
      contentParts.push(c.text);
    }
  }

  const llmMsg: LLMMessage = {
    role,
    content: contentParts.join('\n'),
  };

  if (mmsg.category === 'tool_result' && mmsg.toolCallId) {
    llmMsg.tool_call_id = mmsg.toolCallId;
  }

  if (mmsg.toolCalls && mmsg.toolCalls.length > 0) {
    llmMsg.tool_calls = mmsg.toolCalls;
  }

  return llmMsg;
}

/**
 * 将 MaouMessage 转换为 SessionMessage 格式
 * 用于持久化存储。Maou 注解通过 _maouMeta 字段无损保留。
 */
export function maouToSessionMessage(mmsg: MaouMessage): SessionMessage {
  // 拼接所有内容块的文本用于存储
  const fullText = mmsg.contents.map(c => c.text).join('\n');

  const sessionMsg: SessionMessage = {
    role: mmsg.originalRole ?? (mmsg.category === 'tool_result' ? 'tool' : mmsg.category),
    content: fullText,
    createdAt: mmsg.createdAt ?? new Date().toISOString(),
    pinned: mmsg.pinned ?? false,
    source: mmsg.source,
  };

  if (mmsg.toolCallId) {
    sessionMsg.toolCallId = mmsg.toolCallId;
  }

  if (mmsg.toolCalls && mmsg.toolCalls.length > 0) {
    sessionMsg.toolCalls = mmsg.toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      name: tc.name,
      arguments: tc.arguments,
    }));
  }

  // Maou 注解无损持久化
  const meta: MaouMeta = {
    seqId: mmsg.seqId,
    taskIds: mmsg.taskIds,
    category: mmsg.category,
    keepAfterCompress: mmsg.keepAfterCompress,
  };
  // 保存各内容块的微压缩配置
  const microCompacts = mmsg.contents
    .map(c => c.microCompact)
    .filter(Boolean);
  if (microCompacts.length > 0) {
    meta.contentsMicroCompact = microCompacts as NonNullable<MaouContent['microCompact']>[];
  }
  if (mmsg.meta) {
    meta.meta = mmsg.meta;
  }
  if (mmsg.compact) {
    meta.compact = mmsg.compact;
  }
  sessionMsg._maouMeta = meta;

  if (mmsg.metadata) {
    Object.assign(sessionMsg, mmsg.metadata);
  }

  return sessionMsg;
}

/**
 * 将 SessionMessage 转换为 MaouMessage 格式
 * 优先从 _maouMeta 恢复注解；缺失时退化为推断默认值。
 */
export function sessionToMaouMessage(smsg: SessionMessage, seqId: number): MaouMessage {
  const meta = (smsg._maouMeta ?? smsg._harness_meta) as MaouMeta | undefined;

  let category: MaouMessage['category'];
  if (meta?.category) {
    category = meta.category;
  } else {
    // 优先用 kind 语义，避免伪 user 被当成真人任务起点
    const kind = resolveSessionEventKind({
      role: smsg.role,
      source: smsg.source,
      kind: typeof smsg.kind === "string" ? smsg.kind : undefined,
      toolCallId: smsg.toolCallId,
      tool_call_id: smsg.tool_call_id as string | undefined,
      content: smsg.content,
      queued: Boolean(smsg.queued),
    });
    if (kind === "tool_result" || kind === "tool_async_notify") {
      category = "tool_result";
    } else if (kind === "assistant_turn" || kind === "tool_call") {
      const hasToolCalls = smsg.toolCalls && smsg.toolCalls.length > 0;
      category = hasToolCalls ? "tool_call" : "assistant";
    } else if (kind === "system_notice" || kind === "runtime_control" || kind === "agent_message") {
      category = "injected";
    } else if (kind === "compact") {
      category = "compact";
    } else if (smsg.role === "system") {
      category = "system";
    } else if (smsg.source === "hook" || smsg.source === "injected") {
      category = "injected";
    } else {
      category = isHumanTurnKind(kind) ? "user" : "injected";
    }
  }

  // content + microCompact（从 meta 恢复或构造默认）
  // 思考回灌：session 上的 reasoningContent（由 thinking_context_mode 在写入时决定是否保留）
  // 在进入 ContextEngine / LLM 历史前并入文本，保证压缩与 token 估算一致。
  const contents: MaouContent[] = [];
  const content: MaouContent = {
    text: contentWithThinkingForLlm(
      smsg.content ?? "",
      typeof smsg.reasoningContent === "string" ? smsg.reasoningContent : undefined,
    ),
  };
  // 从 meta 恢复第一个内容块的微压缩配置
  if (meta?.contentsMicroCompact && meta.contentsMicroCompact.length > 0) {
    content.microCompact = meta.contentsMicroCompact[0];
    // 如果有多个内容块的微压缩配置，恢复其余的
    for (let i = 1; i < meta.contentsMicroCompact.length; i++) {
      contents.push({
        text: '', // 已合并到第一个块，这里仅保留微压缩配置索引
        microCompact: meta.contentsMicroCompact[i],
      });
    }
  }
  contents.unshift(content);

  const mmsg: MaouMessage = {
    seqId: meta?.seqId ?? seqId,
    taskIds: meta?.taskIds ?? [],
    contents,
    keepAfterCompress: meta?.keepAfterCompress ?? (smsg.pinned ?? false),
    category,
    createdAt: smsg.createdAt,
    pinned: smsg.pinned ?? false,
    originalRole: smsg.role as MaouMessage['originalRole'],
    source: smsg.source,
  };

  // 恢复 meta 和 compact
  if (meta?.meta) {
    mmsg.meta = meta.meta;
  }
  if (meta?.compact) {
    mmsg.compact = meta.compact;
  }

  if (smsg.toolCallId) {
    mmsg.toolCallId = smsg.toolCallId;
  }

  if (smsg.toolCalls && smsg.toolCalls.length > 0) {
    mmsg.toolCalls = smsg.toolCalls.map(tc => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments ?? {},
    }));
  }

  return mmsg;
}

/**
 * 批量转换 SessionMessage 数组为 MaouMessage 数组
 * 自动分配 seqId
 */
export function sessionMessagesToMaou(msgs: SessionMessage[]): MaouMessage[] {
  return msgs.map((m, idx) => sessionToMaouMessage(m, idx));
}

/**
 * 批量转换 MaouMessage 数组为 LLMMessage 数组
 */
export function maouMessagesToLLM(mmsgs: MaouMessage[]): LLMMessage[] {
  return mmsgs.map(maouToLLMMessage);
}
