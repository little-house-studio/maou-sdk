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
  /** 内容块 */
  content: HarnessContent;
  /** 压缩后是否保留 */
  keep_after_compress: boolean;
  /** 微压缩配置 */
  micro_compact_config?: {
    enabled: boolean;
    mode: 'summary' | 'placeholder';
  };
  /** 消息类别 */
  category: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'injected';
  /** 创建时间 (ISO string) */
  created_at?: string;
  /** 优先级 (用于压缩决策) */
  priority?: 'critical' | 'important' | 'normal';
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
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
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
 * 任务块
 */
export interface HarnessTaskBlock {
  task_id: string;
  task_summary: string;
  task_outline: string;
  messages: LLMMessage[]; // 使用 LLMMessage 结构体
}

// ─── 转换函数 ─────────────────────────────────────────────────────────────

/**
 * 将 HarnessMessage 转换为 LLMMessage 格式
 * 用于发送给 LLM API
 */
export function harnessToLLMMessage(hmsg: HarnessMessage): LLMMessage {
  // 确定 role：优先使用 original_role，否则根据 category 推断
  let role: LLMMessage['role'];
  if (hmsg.original_role) {
    role = hmsg.original_role;
  } else {
    // category → role 映射
    switch (hmsg.category) {
      case 'user':
      case 'injected':
        role = 'user';
        break;
      case 'assistant':
        role = 'assistant';
        break;
      case 'tool_call':
        role = 'assistant'; // tool_call 属于 assistant 消息的一部分
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

  // 获取文本内容
  let content = hmsg.content.text_content;
  // 如果启用了微压缩且有摘要，使用摘要
  if (hmsg.content.micro_compact?.enabled && hmsg.content.micro_compact.summary) {
    content = hmsg.content.micro_compact.summary;
  }

  const llmMsg: LLMMessage = {
    role,
    content,
  };

  // 添加 tool_call_id (tool_result)
  if (hmsg.category === 'tool_result' && hmsg.tool_call_id) {
    llmMsg.tool_call_id = hmsg.tool_call_id;
  }

  // 添加 tool_calls (tool_call 或 assistant 带 tool_calls)
  if (hmsg.tool_calls && hmsg.tool_calls.length > 0) {
    llmMsg.tool_calls = hmsg.tool_calls;
  }

  return llmMsg;
}

/**
 * 将 HarnessMessage 转换为 SessionMessage 格式
 * 用于持久化存储，保持向后兼容
 */
export function harnessToSessionMessage(hmsg: HarnessMessage): SessionMessage {
  const sessionMsg: SessionMessage = {
    role: hmsg.original_role ?? (hmsg.category === 'tool_result' ? 'tool' : hmsg.category),
    content: hmsg.content.text_content,
    created_at: hmsg.created_at ?? new Date().toISOString(),
    priority: hmsg.priority ?? 'normal',
    pinned: hmsg.pinned ?? false,
    source: hmsg.source,
  };

  // 保留 tool_call_id
  if (hmsg.tool_call_id) {
    sessionMsg.tool_call_id = hmsg.tool_call_id;
  }

  // 保留 tool_calls (存储为 native_tool_calls)
  if (hmsg.tool_calls && hmsg.tool_calls.length > 0) {
    sessionMsg.native_tool_calls = hmsg.tool_calls.map(tc => ({
      id: tc.id,
      type: 'function',
      name: tc.name,
      parameters: tc.arguments,
    }));
  }

  // 合并其他 metadata
  if (hmsg.metadata) {
    Object.assign(sessionMsg, hmsg.metadata);
  }

  return sessionMsg;
}

/**
 * 将 SessionMessage 转换为 HarnessMessage 格式
 * 用于从存储加载后在 Harness 层处理
 */
export function sessionToHarnessMessage(smsg: SessionMessage, seqId: number): HarnessMessage {
  // 确定 category
  let category: HarnessMessage['category'];
  const role = smsg.role;

  if (role === 'tool') {
    category = 'tool_result';
  } else if (role === 'assistant') {
    // 如果有 native_tool_calls，则为 tool_call 类别
    const hasToolCalls = smsg.native_tool_calls && smsg.native_tool_calls.length > 0;
    category = hasToolCalls ? 'tool_call' : 'assistant';
  } else if (role === 'system') {
    category = 'system';
  } else if (smsg.source === 'hook' || smsg.source === 'injected') {
    category = 'injected';
  } else {
    category = 'user';
  }

  // 构建 content
  const content: HarnessContent = {
    text_content: smsg.content ?? '',
  };

  // 构建 HarnessMessage
  const hmsg: HarnessMessage = {
    seq_id: seqId,
    task_ids: [], // 默认空数组，由上层填充
    content,
    keep_after_compress: smsg.pinned ?? false,
    category,
    created_at: smsg.created_at,
    priority: smsg.priority as HarnessMessage['priority'] ?? 'normal',
    pinned: smsg.pinned ?? false,
    original_role: role as HarnessMessage['original_role'],
    source: smsg.source,
  };

  // 保留 tool_call_id
  if (smsg.tool_call_id) {
    hmsg.tool_call_id = smsg.tool_call_id;
  }

  // 转换 native_tool_calls → ToolCall
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