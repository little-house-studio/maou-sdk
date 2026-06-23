/**
 * 上下文压缩阶段类型
 * 命名采用描述性长名称，便于理解和后续修改
 */

import type { TaskStatus } from "./message.js";

// 压缩阶段类型
type CompressionStage =
  | 'staticStage'      // 嵌入结构阶段：固定不变，包含用户偏好、项目信息等
  | 'archiveStage'     // 死阶段：第二次大压缩后只剩任务块摘要+ID
  | 'summaryStage'     // 大压缩阶段：第一次压缩后保留内容过程摘要
  | 'compactStage'     // 微压缩阶段：标注微压缩的信息变摘要
  | 'activeStage';     // 动态阶段：保留原始消息，不压缩

// 压缩配置
interface CompressionConfig {
  enabled: boolean;
  stage: CompressionStage;
  triggerThreshold?: number; // 触发压缩的 token 阈值
}

// 微压缩配置
interface MicroCompactConfig {
  enabled: boolean;
  mode: 'summary' | 'placeholder' | 'none';
  preserveToolResult?: boolean; // 是否保留工具结果
}

// 大压缩结果
interface CompressionResult {
  stage: CompressionStage;
  originalTokens: number;
  compressedTokens: number;
  summary?: string;
  taskBlocks?: string[]; // 任务块 ID 列表
}

// 任务摘要（对齐 MaouTaskBlock 核心字段）
interface TaskSummary {
  taskId: string;
  parentTaskId?: string;
  status: TaskStatus;
  summary: string;
  goal?: string;
  context?: string;
  outline: string[];
  notes?: string[];
  progress?: number;
  currentStep?: string;
  dependencies?: string[];
  relatedFiles?: string[];
  tags?: string[];
  startTime: string;
  endTime?: string;
}

export type {
  CompressionStage,
  CompressionConfig,
  MicroCompactConfig,
  CompressionResult,
  TaskSummary
};
