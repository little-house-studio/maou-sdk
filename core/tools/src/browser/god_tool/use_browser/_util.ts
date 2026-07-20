/**
 * browser 工具本地 util。
 * 通用函数已迁至 `tools/src/util/common.ts`；此处 re-export 保持旧 import 路径可用。
 */

export {
  DEFAULT_CHUNK_LIMIT,
  truncateMiddle,
  formatMetadata,
  errToString,
} from "../../../util/common.js";

/**
 * 安全路径解析，防止路径越界（../../etc/passwd 等）。
 * 统一 read / write-file / edit-file 共用。
 * 实现委托 path-guard（与 PathGuard 多根沙箱同一套 isUnder 逻辑）。
 */
export { safePath } from "../../../path-guard.js";
