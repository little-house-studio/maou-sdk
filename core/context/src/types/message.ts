/**
 * Harness 层消息结构体
 * 依赖 Context 层，用于灵活解析和压缩优化
 */

import type { SessionMessage } from "../session-store.js";

/**
 * 内容块
 */
export interface HarnessContent {
  text_content: string;
  micro_compact?: {
    enabled: boolean;
    summary?: string; // 微压缩后的摘要
  };
  new_line?: boolean;
}

/**
 * 消息块 - Harness 层使用的结构化消息
 * 支持 seq_id 用于排序和追踪
 */
export interface HarnessMessage {
  /** 系统分配的顺序ID，用于排序和追踪 */
  seq_id: number;
  /** 所属任务ID数组 */
  task_ids: string[];
  /** 内容块数组（支持一条消息多个段，各段独立压缩配置） */
  contents: HarnessContent[];
  /** 压缩后是否保留 */
  keep_after_compress: boolean;
  /** 消息类别 */
  category: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'injected' | 'compact' | 'diff' | 'baked';
  /** 创建时间 (ISO string) */
  created_at?: string;
  /** 是否固定 (压缩时永不丢弃) */
  pinned?: boolean;
  /** 原始 role (兼容 LLM API) */
  original_role?: 'user' | 'assistant' | 'tool' | 'system';
  /** 工具调用 ID (tool_result 类别时使用) */
  tool_call_id?: string;
  /** 工具调用列表 (tool_call 类别时使用) */
  tool_calls?: LLMToolCall[];
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
  compactType: "micro" | "major" | "dead";
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
  msgId: string;
  /** 消息角色 */
  role: "user" | "assistant" | "tool" | "system";
  /** 消息分类 */
  type: 'user' | 'ai' | 'tool_result' | 'compact' | 'diff' | 'baked' | 'system' | 'custom';
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
  contextPrefix?: {
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
 * 命名从原 taskMeta 改为 TaskBlock，体现它是完整结构体而非仅元数据。
 */
export interface TaskBlock {
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
  context?: string;
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
  pinnedSnippets?: PinnedSnippet[];
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
export interface PinnedSnippet {
  /** 文件路径 */
  path: string;
  /** 引用片段内容 */
  snippet: string;
  /** 为什么重要 */
  reason: string;
}

// ─── 转换函数 ─────────────────────────────────────────────────────────────

/**
 * harness 注解持久化载体。
 * 存入 SessionMessage._harness_meta，恢复时无损回填到 HarnessMessage。
 */
export interface HarnessMeta {
  seq_id: number;
  task_ids: string[];
  category: HarnessMessage['category'];
  keep_after_compress: boolean;
  /** 内容块的微压缩配置（按数组索引对应） */
  contents_micro_compact?: Array<HarnessContent['micro_compact']>;
  meta?: MessageMeta;
  compact?: CompactMessage;
}

/**
 * 将 HarnessMessage 转换为 LLMMessage 格式
 * 用于发送给 LLM API
 */
export function harnessToLLMMessage(hmsg: HarnessMessage): LLMMessage {
  let role: LLMMessage['role'];
  if (hmsg.original_role) {
    role = hmsg.original_role;
  } else {
    switch (hmsg.category) {
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
  for (const c of hmsg.contents) {
    if (c.micro_compact?.enabled && c.micro_compact.summary) {
      contentParts.push(c.micro_compact.summary);
    } else {
      contentParts.push(c.text_content);
    }
  }

  const llmMsg: LLMMessage = {
    role,
    content: contentParts.join('\n'),
  };

  if (hmsg.category === 'tool_result' && hmsg.tool_call_id) {
    llmMsg.tool_call_id = hmsg.tool_call_id;
  }

  if (hmsg.tool_calls && hmsg.tool_calls.length > 0) {
    llmMsg.tool_calls = hmsg.tool_calls;
  }

  return llmMsg;
}

/**
 * 将 HarnessMessage 转换为 SessionMessage 格式
 * 用于持久化存储。harness 注解通过 _harness_meta 字段无损保留。
 */
export function harnessToSessionMessage(hmsg: HarnessMessage): SessionMessage {
  // 拼接所有内容块的文本用于存储
  const fullText = hmsg.contents.map(c => c.text_content).join('\n');

  const sessionMsg: SessionMessage = {
    role: hmsg.original_role ?? (hmsg.category === 'tool_result' ? 'tool' : hmsg.category),
    content: fullText,
    created_at: hmsg.created_at ?? new Date().toISOString(),
    pinned: hmsg.pinned ?? false,
    source: hmsg.source,
  };

  if (hmsg.tool_call_id) {
    sessionMsg.tool_call_id = hmsg.tool_call_id;
  }

  if (hmsg.tool_calls && hmsg.tool_calls.length > 0) {
    sessionMsg.native_tool_calls = hmsg.tool_calls.map(tc => ({
      id: tc.id,
      type: 'function',
      name: tc.name,
      parameters: tc.arguments,
    }));
  }

  // harness 注解无损持久化
  const meta: HarnessMeta = {
    seq_id: hmsg.seq_id,
    task_ids: hmsg.task_ids,
    category: hmsg.category,
    keep_after_compress: hmsg.keep_after_compress,
  };
  // 保存各内容块的微压缩配置
  const microCompacts = hmsg.contents
    .map(c => c.micro_compact)
    .filter(Boolean);
  if (microCompacts.length > 0) {
    meta.contents_micro_compact = microCompacts as NonNullable<HarnessContent['micro_compact']>[];
  }
  if (hmsg.meta) {
    meta.meta = hmsg.meta;
  }
  if (hmsg.compact) {
    meta.compact = hmsg.compact;
  }
  sessionMsg._harness_meta = meta;

  if (hmsg.metadata) {
    Object.assign(sessionMsg, hmsg.metadata);
  }

  return sessionMsg;
}

/**
 * 将 SessionMessage 转换为 HarnessMessage 格式
 * 优先从 _harness_meta 恢复注解；缺失时退化为推断默认值。
 */
export function sessionToHarnessMessage(smsg: SessionMessage, seqId: number): HarnessMessage {
  const meta = smsg._harness_meta as HarnessMeta | undefined;

  let category: HarnessMessage['category'];
  if (meta?.category) {
    category = meta.category;
  } else {
    const role = smsg.role;
    if (role === 'tool') {
      category = 'tool_result';
    } else if (role === 'assistant') {
      const hasToolCalls = smsg.native_tool_calls && smsg.native_tool_calls.length > 0;
      category = hasToolCalls ? 'tool_call' : 'assistant';
    } else if (role === 'system') {
      category = 'system';
    } else if (smsg.source === 'hook' || smsg.source === 'injected') {
      category = 'injected';
    } else {
      category = 'user';
    }
  }

  // content + micro_compact（从 meta 恢复或构造默认）
  const contents: HarnessContent[] = [];
  const content: HarnessContent = {
    text_content: smsg.content ?? '',
  };
  // 从 meta 恢复第一个内容块的微压缩配置
  if (meta?.contents_micro_compact && meta.contents_micro_compact.length > 0) {
    content.micro_compact = meta.contents_micro_compact[0];
    // 如果有多个内容块的微压缩配置，恢复其余的
    for (let i = 1; i < meta.contents_micro_compact.length; i++) {
      contents.push({
        text_content: '', // 已合并到第一个块，这里仅保留微压缩配置索引
        micro_compact: meta.contents_micro_compact[i],
      });
    }
  }
  contents.unshift(content);

  const hmsg: HarnessMessage = {
    seq_id: meta?.seq_id ?? seqId,
    task_ids: meta?.task_ids ?? [],
    contents,
    keep_after_compress: meta?.keep_after_compress ?? (smsg.pinned ?? false),
    category,
    created_at: smsg.created_at,
    pinned: smsg.pinned ?? false,
    original_role: smsg.role as HarnessMessage['original_role'],
    source: smsg.source,
  };

  // 恢复 meta 和 compact
  if (meta?.meta) {
    hmsg.meta = meta.meta;
  }
  if (meta?.compact) {
    hmsg.compact = meta.compact;
  }

  if (smsg.tool_call_id) {
    hmsg.tool_call_id = smsg.tool_call_id;
  }

  if (smsg.native_tool_calls && smsg.native_tool_calls.length > 0) {
    hmsg.tool_calls = smsg.native_tool_calls.map(tc => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.parameters ?? {},
    }));
  }

  return hmsg;
}

/**
 * 批量转换 SessionMessage 数组为 HarnessMessage 数组
 * 自动分配 seq_id
 */
export function sessionMessagesToHarness(msgs: SessionMessage[]): HarnessMessage[] {
  return msgs.map((m, idx) => sessionToHarnessMessage(m, idx));
}

/**
 * 批量转换 HarnessMessage 数组为 LLMMessage 数组
 */
export function harnessMessagesToLLM(hmsgs: HarnessMessage[]): LLMMessage[] {
  return hmsgs.map(harnessToLLMMessage);
}