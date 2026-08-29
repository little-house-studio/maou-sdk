/**
 * 纯解析入口（浏览器安全）：只做「文本 → 字段」，不碰 config / node 内建。
 *
 * `apply-preset`（写 ~/.maou/config.json）**故意不在这里**——它经 api-presets
 * 拖进 node:fs / node:path，渲染进程 import 本子路径就会打包失败。
 * node 侧要它请从包根 `@little-house-studio/llm` 取。
 */
export { parseClipboard } from "./parse.js";
export type {
  LlmPresetFormValues,
  LlmPresetApplyInput,
  LlmPresetBuildResult,
  LlmPresetApplyResult,
} from "./apply-preset.js";
export { ADDRESS_SCHEMA, LLM_PRESET_SCHEMA } from "./builtins.js";
export { normalizePasteSchema } from "./schema.js";
export { normalizePasteText, peelRegion } from "./extractors.js";
export { extractApiKeys, looksLikeApiKey, API_KEY_MIN } from "./api-key.js";
export {
  extractRequestUrls,
  extractProtocol,
  inferProtocolFromUrl,
  guessProtocolFromUrl,
  DEFAULT_PROTOCOL,
} from "./request-url.js";
export {
  extractModelGuesses,
  looksLikeModelName,
  fetchModelIds,
  fetchPublicCatalogIds,
  builtinCatalogModelIds,
  matchModelsInText,
  matchAllModelsInText,
  extractDeclaredModelIds,
  collectModelIds,
  pickPrimaryModel,
  MODEL_LIST_TIMEOUT_MS,
  MODELS_DEV_URL,
} from "./model-name.js";
export type {
  ExtractorId,
  FieldSource,
  ParseClipboardOptions,
  ParseClipboardResult,
  ParseClipboardSchema,
  ParsedField,
  PasteFieldSpec,
  PasteLlmFill,
  PasteParseResult,
  PasteSchema,
} from "./types.js";
