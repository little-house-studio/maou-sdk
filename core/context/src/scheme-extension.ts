/**
 * 传统方案扩展面。任务插件挂在这里，压核不认识任务店。
 */

import type { MaouMessage, LLMMessage } from "./types/message.js";
import type { CompressionStage } from "./types/compression.js";

export type SummarizerKind = "micro" | "summary" | "task";

export type Summarizer = (input: {
  kind: SummarizerKind;
  taskId?: string;
  messages: LLMMessage[];
  prompt?: string;
}) => Promise<string>;

export interface FoldContext {
  stage: "summary" | "archive";
  compressible: MaouMessage[];
  history: MaouMessage[];
  summarizer?: Summarizer;
  sessionId?: string;
  prior?: FoldResult;
}

export interface FoldResult {
  replacement: MaouMessage[];
  droppedSummary: string;
  foldedOriginals?: Map<string, MaouMessage[]>;
  blockIds?: string[];
  extras?: Record<string, unknown>;
}

export interface AfterCompressContext {
  sessionId: string;
  history: MaouMessage[];
  stage: CompressionStage;
  foldedOriginals?: Map<string, MaouMessage[]>;
  blockIds?: string[];
}

export interface ContextSchemeExtension {
  afterSync?(history: MaouMessage[]): MaouMessage[];
  fold?(ctx: FoldContext): Promise<FoldResult | null>;
  afterCompress?(ctx: AfterCompressContext): void;
  onClearSession?(sessionId: string): void;
}

export function applyAfterSync(
  history: MaouMessage[],
  extensions: readonly ContextSchemeExtension[] | undefined,
): MaouMessage[] {
  let next = history;
  for (const ext of extensions ?? []) {
    if (ext.afterSync) next = ext.afterSync(next);
  }
  return next;
}

export async function applyFold(
  ctx: FoldContext,
  extensions: readonly ContextSchemeExtension[] | undefined,
): Promise<FoldResult | null> {
  for (const ext of extensions ?? []) {
    if (!ext.fold) continue;
    const result = await ext.fold(ctx);
    if (result) return result;
  }
  return null;
}

export function applyAfterCompress(
  ctx: AfterCompressContext,
  extensions: readonly ContextSchemeExtension[] | undefined,
): void {
  for (const ext of extensions ?? []) {
    ext.afterCompress?.(ctx);
  }
}

export function applyOnClearSession(
  sessionId: string,
  extensions: readonly ContextSchemeExtension[] | undefined,
): void {
  for (const ext of extensions ?? []) {
    ext.onClearSession?.(sessionId);
  }
}
