/**
 * 任务会话存储 —— 基于 JSONL 的任务级消息持久化。
 *
 * 存储路径: <maouRoot>/agents/<agentName>/sessions/<sessionId>/task_session/<task_id>.jsonl
 *
 * 每个任务块包含:
 *   - task_id: 任务唯一标识
 *   - task_summary: 任务摘要
 *   - task_outline: 任务大纲（字符串数组）
 *   - messages: LLMMessage[] 消息列表
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { LLMMessage, TaskStatus } from "./types/message.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** AI 主动 pin 的引用片段 */
export interface PinnedSnippet {
  path: string;
  snippet: string;
  reason: string;
}

/** 任务块数据结构（对齐 message.ts TaskBlock） */
export interface TaskBlock {
  taskId: string;
  parentTaskId?: string;
  status: TaskStatus;
  summary: string;
  goal: string;
  context?: string;
  outline: string[];
  notes?: string[];
  progress?: number;
  currentStep?: string;
  dependencies?: string[];
  relatedFiles?: string[];
  pinnedSnippets?: PinnedSnippet[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  messageCount?: number;
  toolCallCount?: number;
  tokenUsage?: number;
  messages: LLMMessage[];
}

/** JSONL 文件中的条目类型 */
interface TaskEntry {
  type: "block" | "message";
  data: Record<string, unknown>;
  created_at: string;
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** 原子写入文件（先写临时文件再重命名） */
function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
}

// ─── TaskSessionStore ────────────────────────────────────────────────────────

export class TaskSessionStore {
  readonly maouRoot: string;
  readonly agentName: string;

  /**
   * @param maouRoot - maou 数据根目录（如 ~/.maou）
   * @param agentName - agent 名称
   */
  constructor(maouRoot: string, agentName: string) {
    this.maouRoot = maouRoot;
    this.agentName = agentName;
  }

  // ── 路径计算 ──

  /**
   * 获取任务 JSONL 文件的完整路径
   */
  taskFilePath(sessionId: string, taskId: string): string {
    return join(
      this.maouRoot,
      "agents",
      this.agentName,
      "sessions",
      sessionId,
      "task_session",
      `${taskId}.jsonl`,
    );
  }

  // ── 核心操作 ──

  /**
   * 创建任务块
   *
   * 写入一个 type="block" 的条目，包含全部 TaskBlock 字段。
   * 如果文件已存在则覆盖。
   */
  createTaskBlock(
    sessionId: string,
    taskId: string,
    summary: string,
    outline: string[],
    options?: {
      parentTaskId?: string;
      status?: TaskStatus;
      goal?: string;
      context?: string;
      tags?: string[];
    },
  ): TaskBlock {
    const filePath = this.taskFilePath(sessionId, taskId);
    const ts = nowIso();

    const blockEntry = {
      type: "block",
      data: {
        task_id: taskId,
        parent_task_id: options?.parentTaskId,
        status: options?.status ?? "running",
        summary,
        goal: options?.goal ?? "",
        context: options?.context,
        outline,
        tags: options?.tags,
      },
      created_at: ts,
    };

    // 原子写入
    atomicWrite(filePath, JSON.stringify(blockEntry) + "\n");

    return {
      taskId,
      parentTaskId: options?.parentTaskId,
      status: options?.status ?? "running",
      summary,
      goal: options?.goal ?? "",
      context: options?.context,
      outline,
      tags: options?.tags,
      messages: [],
      createdAt: ts,
      updatedAt: ts,
    };
  }

  /**
   * 追加消息到任务
   *
   * 在 JSONL 文件末尾追加一条 type="message" 的条目。
   * 如果任务块不存在，会自动创建一个空的任务块。
   */
  appendMessage(sessionId: string, taskId: string, message: LLMMessage): void {
    const filePath = this.taskFilePath(sessionId, taskId);

    // 确保目录存在
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });

    // 如果文件不存在，先创建空任务块
    if (!existsSync(filePath)) {
      this.createTaskBlock(sessionId, taskId, "", []);
    }

    const entry = {
      type: "message",
      data: message,
      created_at: nowIso(),
    };

    appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  /**
   * 获取任务块
   *
   * 读取 JSONL 文件，解析 block 和 message 条目，组装成 TaskBlock。
   * 如果文件不存在返回 null。
   */
  getTaskBlock(sessionId: string, taskId: string): TaskBlock | null {
    const filePath = this.taskFilePath(sessionId, taskId);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let summary = "";
    let goal = "";
    let context_ = "";
    let parentTaskId: string | undefined;
    let status: TaskStatus = "running";
    let outline: string[] = [];
    let tags: string[] = [];
    let createdAt = "";
    let updatedAt = "";
    const messages: LLMMessage[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as TaskEntry;

        if (entry.type === "block") {
          const data = entry.data as {
            task_id?: string;
            parent_task_id?: string;
            status?: string;
            summary?: string;
            goal?: string;
            context?: string;
            outline?: string[];
            tags?: string[];
          };
          summary = data.summary ?? "";
          goal = data.goal ?? "";
          context_ = data.context ?? "";
          parentTaskId = data.parent_task_id;
          status = (data.status as TaskStatus) ?? "running";
          outline = data.outline ?? [];
          tags = data.tags ?? [];
          createdAt = entry.created_at;
          updatedAt = entry.created_at;
        } else if (entry.type === "message") {
          const msg = entry.data as unknown as LLMMessage;
          messages.push(msg);
          if (entry.created_at) {
            updatedAt = entry.created_at;
          }
        }
      } catch {
        // 跳过无法解析的行
        continue;
      }
    }

    return {
      taskId,
      parentTaskId,
      status,
      summary,
      goal,
      context: context_,
      outline,
      tags,
      messages,
      createdAt,
      updatedAt,
    };
  }

  /**
   * 更新任务摘要和大纲
   *
   * 读取现有文件，保留所有消息条目，重写 block 条目。
   * 使用原子写入保证数据完整性。
   */
  updateSummary(
    sessionId: string,
    taskId: string,
    summary: string,
    outline: string[],
    options?: {
      goal?: string;
      context?: string;
      status?: TaskStatus;
      progress?: number;
      currentStep?: string;
      notes?: string[];
      tags?: string[];
    },
  ): TaskBlock | null {
    const filePath = this.taskFilePath(sessionId, taskId);
    if (!existsSync(filePath)) return null;

    // 读取现有内容，保留所有消息条目
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const messageLines: string[] = [];
    let createdAt = "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as TaskEntry;
        if (entry.type === "message") {
          messageLines.push(line);
        } else if (entry.type === "block" && entry.created_at) {
          createdAt = entry.created_at;
        }
      } catch {
        // 跳过无法解析的行
        continue;
      }
    }

    const ts = nowIso();
    const blockEntry = {
      type: "block",
      data: {
        task_id: taskId,
        summary,
        goal: options?.goal ?? "",
        context: options?.context,
        status: options?.status,
        progress: options?.progress,
        current_step: options?.currentStep,
        notes: options?.notes,
        outline,
        tags: options?.tags,
      },
      created_at: createdAt || ts,
    };

    // 原子重写：block 在前，消息在后
    const newContent =
      JSON.stringify(blockEntry) +
      "\n" +
      (messageLines.length > 0 ? messageLines.join("\n") + "\n" : "");

    atomicWrite(filePath, newContent);

    return {
      taskId,
      summary,
      goal: options?.goal ?? "",
      context: options?.context,
      status: options?.status ?? "running",
      progress: options?.progress,
      currentStep: options?.currentStep,
      notes: options?.notes,
      outline,
      tags: options?.tags,
      messages: messageLines.map((line) => JSON.parse(line).data as unknown as LLMMessage),
      createdAt: createdAt || ts,
      updatedAt: ts,
    };
  }

  // ── 辅助方法 ──

  /**
   * 检查任务块是否存在
   */
  exists(sessionId: string, taskId: string): boolean {
    return existsSync(this.taskFilePath(sessionId, taskId));
  }

  /**
   * 删除任务块
   */
  delete(sessionId: string, taskId: string): boolean {
    const filePath = this.taskFilePath(sessionId, taskId);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }

  /**
   * 获取指定会话下的所有任务 ID
   */
  listTasks(sessionId: string): string[] {
    const dirPath = join(
      this.maouRoot,
      "agents",
      this.agentName,
      "sessions",
      sessionId,
      "task_session",
    );
    if (!existsSync(dirPath)) return [];

    return readdirSync(dirPath)
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => f.slice(0, -6)); // 去掉 .jsonl
  }
}
