/**
 * 将 agent 层 TodoOrchestrator 单例绑定到 tools 宿主桥。
 * 由 agent 包入口导入，确保产品路径加载 agent 后工具可调用编排。
 */

import { bindTodoOrchestratorHost } from "@little-house-studio/tools";
import { TodoOrchestrator } from "./todo-orchestrator.js";

export const TODO_ORCHESTRATOR = new TodoOrchestrator();
export { TodoOrchestrator };

bindTodoOrchestratorHost(TODO_ORCHESTRATOR);
