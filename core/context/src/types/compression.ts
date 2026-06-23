/**
 * 上下文压缩区域类型
 * 命名采用描述性长名称，便于理解和后续修改
 */

import type { TaskStatus } from "./message.js";

// 压缩区域类型
type CompressionZone =
  | 'static_zone'      // 嵌入结构区：固定不变，包含用户偏好、项目信息等
  | 'archive_zone'     // 死区：第二次大压缩后只剩任务块摘要+ID
  | 'summary_zone'     // 大压缩区：第一次压缩后保留内容过程摘要
  | 'compact_zone'     // 微压缩区：标注微压缩的信息变摘要
  | 'active_zone';     // 动态区：保留原始消息，不压缩

// 压缩配置
interface CompressionConfig {
  enabled: boolean;
  zone: CompressionZone;
  trigger_threshold?: number; // 触发压缩的 token 阈值
}

// 微压缩配置
interface MicroCompactConfig {
  enabled: boolean;
  mode: 'summary' | 'placeholder' | 'none';
  preserve_tool_result?: boolean; // 是否保留工具结果
}

// 大压缩结果
interface CompressionResult {
  zone: CompressionZone;
  original_tokens: number;
  compressed_tokens: number;
  summary?: string;
  task_blocks?: string[]; // 任务块 ID 列表
}

// 任务摘要（对齐 TaskBlock 核心字段）
interface TaskSummary {
  task_id: string;
  parent_task_id?: string;
  status: TaskStatus;
  summary: string;
  goal?: string;
  context?: string;
  outline: string[];
  notes?: string[];
  progress?: number;
  current_step?: string;
  dependencies?: string[];
  related_files?: string[];
  tags?: string[];
  start_time: string;
  end_time?: string;
}

export type {
  CompressionZone,
  CompressionConfig,
  MicroCompactConfig,
  CompressionResult,
  TaskSummary
};
