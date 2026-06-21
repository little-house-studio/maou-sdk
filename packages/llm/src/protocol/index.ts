/**
 * 协议层 Barrel Export
 * 汇总导出 JSON 提取、修复、扫描、Schema 派生、校验子模块。
 */

export {
  findFirstJsonObjectBounds,
  splitFirstJsonObjectRegion,
  extractJsonCandidate,
  extractJsonText,
  type JsonExtractionResult,
} from "./json-extract.js";

export {
  cloneJsonValue,
  stripJsonComments,
  stripTrailingCommas,
  isJsonObjectSchema,
  stripMarkdownFence,
  repairMissingFields,
  repairPredictField,
} from "./json-repair.js";

export {
  iterTopLevelJsonFields,
  detectToolCallFromPartialJson,
  inferSingleMissingCloser,
} from "./json-scan.js";

export {
  normalizeJsonSettings,
  deriveJsonSettings,
  type JsonSettings,
} from "./json-schema.js";

export {
  validateParsedResponse,
  buildValidationDiagnostic,
  type ValidationResult,
  type BuildDiagnosticOptions,
} from "./json-validation.js";
