/**
 * @little-house-studio/core — 通用基础设施层（核心类型 + 配置 + 工具函数）
 */

// 全部核心类型（含下沉到此处的工具基础类型 ToolCall/ToolDefinition/...）
export * from './types.js'

// 配置管理
export { ConfigStore } from './config-store.js'

// 项目管理
export { getProjectsList, addProject, removeProject, autoDiscover } from './project-manager.js'
export type { ProjectEntry, ProjectListItem } from './project-manager.js'

// 工具函数（飞书专属常量已移出 core —— core 不应懂具体平台）
export {
  MAOU_VERSION,
  isWithinPath,
  coerceBool,
  escapeHtml,
  nowIso,
  isConnectionError,
  DEFAULT_PORT,
  MAX_BODY_SIZE,
  MAX_FILE_PROXY_SIZE,
  URL_PROXY_TIMEOUT_MS,
  SSE_PING_INTERVAL_MS,
  DEFAULT_HOST,
} from './utils.js'

// 表情检测
export { detectExpression } from './expression.js'