/**
 * @deprecated 实现已迁至 @little-house-studio/agent（core/agent/src/agent/todo/）。
 * 本文件保留 tools 侧宿主桥 re-export，保证旧 import 路径不断。
 */
export {
  TODO_ORCHESTRATOR,
  bindTodoOrchestratorHost,
  getTodoOrchestrator,
  setTodoOrchestratorFallbackFactory,
} from "./todo-orchestrator-host.js";
export type {
  TodoForkRunner,
  TodoOrchestratorHost,
} from "./todo-orchestrator-host.js";
