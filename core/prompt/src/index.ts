/**
 * @little-house-studio/prompt — Prompt 层 SDK
 *
 * 纯解析器/编译器层，负责提示词相关的解析、合成、编译、渲染预览。
 * 不存放业务提示词内容（如压缩 prompt 模板属于 context 层）。
 * 不依赖 llm 层（纯文本处理）。
 *
 * 模块：
 *   - compiler: 模板编译（PromptCompiler，{{include}} + {{>>script}}）
 *   - persona: 角色卡系统（PersonaRegistry + CharacterCard + compilePersona）
 *   - preview: 渲染预览（HTML/Markdown/终端高亮 + 文件监听热重载）
 *   - dynamic: 动态上下文模板（formatAgentStatus 等纯模板）
 */

// ─── 模板编译 ──────────────────────────────────────────────────────────────
export { PromptCompiler } from "./compiler/prompt-compiler.js";
export type { PromptCompilerOptions } from "./compiler/prompt-compiler.js";
export type { CompileResult } from "./compiler/types.js";

// ─── 角色卡系统 ────────────────────────────────────────────────────────────
export { PersonaRegistry } from "./persona/registry.js";
export {
  compilePersona,
  compilePersonas,
} from "./persona/compiler.js";
export type { CompilePersonaOptions, PersonaSection } from "./persona/compiler.js";
export {
  exportCard,
  exportCards,
  importCard,
  importCards,
} from "./persona/importer.js";
export type {
  CharacterCard,
  Relationship,
  RelationshipType,
  CharacterBook,
  CharacterBookEntry,
  PersonaStats,
  CreatePersonaOptions,
} from "./persona/types.js";

// ─── 渲染预览 ──────────────────────────────────────────────────────────────
export { renderPreview } from "./preview/renderer.js";
export type { PreviewFormat, PreviewOptions } from "./preview/renderer.js";
export { PromptWatcher } from "./preview/watcher.js";
export type { WatchOptions, WatchCallback, WatchErrorCallback } from "./preview/watcher.js";

// ─── 动态上下文模板 ────────────────────────────────────────────────────────
export {
  formatAgentStatus,
  formatTerminalStatus,
  compileDynamicContextTemplate,
} from "./dynamic/format-status.js";
export type {
  PersonaStatus,
  PersonaStatusProvider,
  TerminalStatusProvider,
} from "./dynamic/types.js";
