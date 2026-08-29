/**
 * 省略尺的实现已挪到 core/types（core/tools 也要用同一套出路文案）。
 * 这里只做转发，保持 core/context 内部的引用路径不变。
 */

export {
  TOOL_RESULT_OMIT_MARKER,
  buildRetentionNotice,
  describeOmitted,
  formatRetentionNotice,
  omissionFromCounts,
  spillRetrieveHint,
} from "@little-house-studio/types";
export type { Omission, OmissionUnit, RetentionNotice } from "@little-house-studio/types";
