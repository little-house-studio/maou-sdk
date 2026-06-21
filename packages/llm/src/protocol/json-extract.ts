/**
 * JSON 提取 —— 从模型原始输出文本中提取 JSON 候选内容。
 * 处理 Markdown 围栏、注释、尾逗号、缺失闭合符等噪声。
 * 对应 Python: core/protocol/json_extraction.py
 */

import { stripTrailingCommas, stripJsonComments } from "./json-repair.js";
import { inferSingleMissingCloser } from "./json-scan.js";

/** 预览文本（截断显示） */
function previewText(text: string, limit = 180): string {
  const content = (text ?? "").trim();
  if (content.length <= limit) return content;
  return content.slice(0, Math.max(32, limit - 1)) + "\u2026";
}

/**
 * 查找第一个 JSON 对象的边界
 * 返回 [start, end] 或 null
 */
export function findFirstJsonObjectBounds(text: string): [number, number] | null {
  const raw = text ?? "";
  let index = 0;
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let start: number | null = null;
  let depth = 0;

  while (index < raw.length) {
    const char = raw[index];
    const nextChar = index + 1 < raw.length ? raw[index + 1] : "";

    if (inLineComment) {
      if (char === "\r" || char === "\n") inLineComment = false;
      index++;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index++;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index++;
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      index += 2;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }

    if (char === '"') {
      inString = true;
      index++;
      continue;
    }

    if (start === null) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      index++;
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return [start, index + 1];
      }
    }
    index++;
  }

  return null;
}

/**
 * 分割第一个 JSON 对象区域
 * 返回 [prefix, objectText, suffix]
 */
export function splitFirstJsonObjectRegion(text: string): [string, string, string] {
  const bounds = findFirstJsonObjectBounds(text);
  if (!bounds) return [text ?? "", "", ""];
  const [start, end] = bounds;
  const raw = text ?? "";
  return [raw.slice(0, start), raw.slice(start, end), raw.slice(end)];
}

/** 检测文本是否包含 XML/HTML 标记包装 */
function containsMarkupWrapper(text: string): boolean {
  const normalized = (text ?? "").trim();
  if (!normalized) return false;
  return /<\s*\/?\s*[A-Za-z][\w:-]*(?:\s+[^<>\n]*)?>/.test(normalized);
}

/**
 * 提取 Markdown 围栏中的 JSON 区域
 * 返回 [outerPrefix, inner, outerSuffix, language] 或 null
 */
function extractFencedJsonRegion(text: string): [string, string, string, string] | null {
  const raw = text ?? "";
  const pattern = /```([A-Za-z0-9_-]+)?\s*\n?([\s\S]*?)\n?```/gm;
  const match = pattern.exec(raw);
  if (!match) return null;

  const language = (match[1] ?? "").trim().toLowerCase();
  const inner = (match[2] ?? "").trim();
  if (!inner.includes("{")) return null;
  if (language && language !== "json" && language !== "jsonc") return null;

  return [
    raw.slice(0, match.index),
    inner,
    raw.slice(match.index + match[0].length),
    language || "plain",
  ];
}

/** 提取部分 JSON 候选 */
function extractPartialJsonCandidate(response: string): string {
  const raw = response ?? "";
  const fenceIndex = raw.indexOf("```");
  let braceIndex: number;
  if (fenceIndex >= 0) {
    braceIndex = raw.indexOf("{", fenceIndex);
  } else {
    braceIndex = raw.indexOf("{");
  }
  if (braceIndex < 0) return "";
  return raw.slice(braceIndex);
}

export interface JsonExtractionResult {
  candidateText: string;
  rawCandidateText: string;
  prefix: string;
  suffix: string;
  objectComplete: boolean;
  providerWrapperDetected: boolean;
  repairsApplied: string[];
  extractionSource: string;
  missingFinalCloserApplied: boolean;
}

/**
 * 提取 JSON 候选文本
 * 对应 Python: _extract_json_candidate
 */
export function extractJsonCandidate(
  response: string,
  normalizedSettings: Record<string, unknown>,
): JsonExtractionResult {
  const raw = (response ?? "").replace(/\uFEFF/g, "").trim();
  const repairsApplied: string[] = [];
  let extractionSource = "raw";

  const fenceRegion = extractFencedJsonRegion(raw);
  let outerPrefix = "";
  let outerSuffix = "";
  let candidateSource = raw;

  if (fenceRegion) {
    [, candidateSource, outerSuffix, extractionSource] = fenceRegion;
    extractionSource = `fence:${extractionSource}`;
    repairsApplied.push("strip_markdown_fence");
  }

  const [prefix, objectText, suffix] = splitFirstJsonObjectRegion(candidateSource);
  let candidate: string;
  let combinedPrefix: string;
  let combinedSuffix: string;
  let objectComplete: boolean;

  if (objectText) {
    candidate = objectText;
    combinedPrefix = outerPrefix + prefix;
    combinedSuffix = suffix + outerSuffix;
    objectComplete = true;
  } else {
    const partial = extractPartialJsonCandidate(candidateSource).trim();
    const braceIndex = candidateSource.indexOf("{");
    combinedPrefix = outerPrefix + (braceIndex >= 0 ? candidateSource.slice(0, braceIndex) : candidateSource);
    combinedSuffix = outerSuffix;
    candidate = partial;
    objectComplete = false;
  }

  if (combinedPrefix.trim() || combinedSuffix.trim()) {
    repairsApplied.push("strip_prefix_suffix_noise");
  }

  const providerWrapperDetected =
    containsMarkupWrapper(combinedPrefix) || containsMarkupWrapper(combinedSuffix);

  let cleanedCandidate = candidate.trim();
  const cleanedWithoutComments = stripJsonComments(cleanedCandidate);
  if (cleanedWithoutComments !== cleanedCandidate) {
    repairsApplied.push("strip_json_comments");
  }
  cleanedCandidate = cleanedWithoutComments.trim();

  const cleanedWithoutTrailingCommas = stripTrailingCommas(cleanedCandidate);
  if (cleanedWithoutTrailingCommas !== cleanedCandidate) {
    repairsApplied.push("strip_trailing_commas");
  }
  cleanedCandidate = cleanedWithoutTrailingCommas.trim();

  let missingFinalCloserApplied = false;

  const requiredFields = Array.isArray(normalizedSettings.required_fields)
    ? (normalizedSettings.required_fields as string[])
    : [];
  const repairedCandidate = inferSingleMissingCloser(cleanedCandidate, requiredFields);
  if (repairedCandidate !== null) {
    cleanedCandidate = repairedCandidate;
    missingFinalCloserApplied = true;
    repairsApplied.push("append_single_missing_closer");
  }

  return {
    candidateText: cleanedCandidate,
    rawCandidateText: candidate.trim(),
    prefix: combinedPrefix,
    suffix: combinedSuffix,
    objectComplete,
    providerWrapperDetected,
    repairsApplied,
    extractionSource,
    missingFinalCloserApplied,
  };
}

/**
 * 简化版 JSON 文本提取
 * 对应 Python: _extract_json_text
 */
export function extractJsonText(response: string): string {
  const result = extractJsonCandidate(response, {});
  return (result.candidateText ?? "").trim();
}
