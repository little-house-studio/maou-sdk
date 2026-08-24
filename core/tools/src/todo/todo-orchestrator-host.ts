/**
 * Todo 编排宿主桥 —— tools 不依赖 agent 包，由 agent 在加载时 bind。
 *
 * 产品路径：@little-house-studio/agent 创建 TodoOrchestrator 单例并 bind。
 * tools 的 todo_manage / todo_finish 通过 getTodoOrchestrator() 调用。
 * 未 bind 时：若存在本地 fallback（测试 setup），用 fallback；否则抛错。
 */

import type { Task } from "./task_manage/tool.js";
import type {
  TodoEvent,
  TodoFinishInput,
  TodoLane,
  TodoNotice,
  TodoPlanMeta,
} from "./todo-types.js";

/** 真 fork 回调形状（与 agent TodoOrchestrator 对齐） */
export type TodoForkRunner = (args: {
  rootSessionId: string;
  planId: string;
  lane: TodoLane;
  node: Task;
  notices: TodoNotice[];
}) => void | Promise<void>;

/** tools 所需的编排器表面（避免 import agent 类） */
export interface TodoOrchestratorHost {
  setForkRunner(runner: TodoForkRunner | undefined): void;
  setRealForkEnabled(enabled: boolean): void;
  onEvent(fn: (ev: TodoEvent) => void): () => void;
  resolveRootSession(sessionId: string): string;
  bindForkSession(forkSessionId: string, rootSessionId: string): void;
  getPlan(rootSessionId: string): TodoPlanMeta | undefined;
  getLanes(rootSessionId: string): TodoLane[];
  getEvents(rootSessionId: string): TodoEvent[];
  drainNotices(sessionId: string): TodoNotice[];
  requeueNotices(sessionId: string, notices: TodoNotice[]): void;
  getTasks(sessionId: string): Task[];
  listActiveRootSessions(): string[];
  debugSnapshot(sessionId: string): unknown;
  manage(sessionId: string, action: string, tasksRaw: Record<string, unknown>[] | null | undefined): string;
  finish(sessionId: string, input: TodoFinishInput): string;
  evaluateNudge(
    sessionId: string,
    actorSessionId: string,
    hadToolCalls: boolean,
  ): TodoNotice | null;
}

let host: TodoOrchestratorHost | null = null;
let fallbackFactory: (() => TodoOrchestratorHost) | null = null;

/** agent 在模块加载时调用，挂接权威单例 */
export function bindTodoOrchestratorHost(impl: TodoOrchestratorHost): void {
  host = impl;
}

/** 测试用：注册「未 bind 时」的本地工厂（tools vitest setup） */
export function setTodoOrchestratorFallbackFactory(
  factory: (() => TodoOrchestratorHost) | null,
): void {
  fallbackFactory = factory;
}

export function getTodoOrchestrator(): TodoOrchestratorHost {
  if (host) return host;
  if (fallbackFactory) {
    host = fallbackFactory();
    return host;
  }
  throw new Error(
    "TodoOrchestrator host 未绑定。请先加载 @little-house-studio/agent，" +
      "或在测试中调用 bindTodoOrchestratorHost / setTodoOrchestratorFallbackFactory。",
  );
}

/**
 * 兼容旧 `TODO_ORCHESTRATOR.xxx` 调用点的代理单例。
 * 方法在首次访问时 resolve host。
 */
export const TODO_ORCHESTRATOR: TodoOrchestratorHost = new Proxy(
  {} as TodoOrchestratorHost,
  {
    get(_target, prop, _receiver) {
      const h = getTodoOrchestrator();
      const value = (h as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return (value as (...args: unknown[]) => unknown).bind(h);
      }
      return value;
    },
  },
);
