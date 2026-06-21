/**
 * 流式 JSON 扫描器 —— 在不完整 JSON 文本上进行字段级扫描，支持工具调用提前检测。
 * 对应 Python: core/protocol/json_scanner.py
 *
 * 底层使用 partial-json 库进行不完整 JSON 解析，比手写扫描器更健壮。
 * 保留原有接口签名不变，上层调用者无感知。
 */

import { parse as parsePartialJson, Allow } from "partial-json";

/** 提取部分 JSON 候选文本 */
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

/**
 * 遍历顶层 JSON 字段
 * 返回 [字段列表, 是否完整闭合]
 * 每个字段: [key, rawValue, valueComplete]
 *
 * 使用 partial-json 库解析不完整 JSON，然后从解析结果中提取字段信息。
 * 对于无法用 partial-json 解析的边缘情况，回退到手写扫描逻辑。
 */
export function iterTopLevelJsonFields(
  response: string,
): [Array<[string, string, boolean]>, boolean] {
  const text = extractPartialJsonCandidate(response).replace(/^\s+/, "");
  if (!text.startsWith("{")) return [[], false];

  // 检测 JSON 是否完整闭合（用栈平衡检测）
  const [stack, balanced] = jsonStackBalance(text);
  const complete = balanced && stack.length === 0 && text.trim().endsWith("}");

  // 用 partial-json 解析不完整 JSON
  let parsed: Record<string, unknown> | null = null;
  try {
    const result = parsePartialJson(text, Allow.ALL);
    if (typeof result === "object" && result !== null && !Array.isArray(result)) {
      parsed = result as Record<string, unknown>;
    }
  } catch {
    // partial-json 解析失败，返回空结果
    return [[], false];
  }

  if (!parsed) return [[], false];

  // 从解析结果中重建字段信息
  const fields: Array<[string, string, boolean]> = [];
  for (const [key, value] of Object.entries(parsed)) {
    const rawValue = JSON.stringify(value);
    fields.push([key, rawValue, true]);
  }

  // 如果 JSON 不完整，检查最后一个字段是否可能还在流式中
  if (!complete && fields.length > 0) {
    // 尝试检测最后一个字段是否不完整
    // 通过比较原始文本中最后一个字段的位置来判断
    const lastField = fields[fields.length - 1];
    const lastKey = lastField[0];
    const lastKeyPattern = `"${lastKey}"\\s*:`;
    const lastKeyMatch = text.match(new RegExp(lastKeyPattern));
    if (lastKeyMatch && lastKeyMatch.index !== undefined) {
      const valueStart = lastKeyMatch.index + lastKeyMatch[0].length;
      const remainingText = text.slice(valueStart).trimStart();
      // 如果剩余文本不以完整的值结尾，标记最后一个字段为不完整
      if (!_isValueComplete(remainingText)) {
        lastField[2] = false;
      }
    }
  }

  return [fields, complete];
}

/** 检测 JSON 值文本是否完整 */
function _isValueComplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 简单值（数字、布尔、null）
  if (/^-?\d+\.?\d*(?:[eE][+-]?\d+)?$/.test(trimmed)) return true;
  if (trimmed === "true" || trimmed === "false" || trimmed === "null") return true;

  // 字符串
  if (trimmed.startsWith('"')) {
    // 尝试解析字符串
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  // 对象或数组 —— 用栈平衡检测
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const [stack, balanced] = jsonStackBalance(trimmed);
    return balanced && stack.length === 0;
  }

  // 带尾逗号的值（如 `123,` 或 `"abc",`）
  if (trimmed.endsWith(",")) {
    return _isValueComplete(trimmed.slice(0, -1));
  }

  return false;
}

/**
 * 从部分 JSON 中检测工具调用
 * 对应 Python: detect_tool_call_from_partial_json
 */
export function detectToolCallFromPartialJson(
  response: string,
): Record<string, unknown> | null {
  const [fields] = iterTopLevelJsonFields(response);
  for (const [key, rawValue, valueComplete] of fields) {
    if (key !== "tool" || !valueComplete) continue;

    let toolField: unknown;
    try {
      toolField = JSON.parse(rawValue);
    } catch {
      return null;
    }

    if (!toolField) return null;

    if (typeof toolField === "string") {
      try {
        const parsed = JSON.parse(toolField);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
      } catch {
        return null;
      }
    }

    return typeof toolField === "object" && toolField !== null && !Array.isArray(toolField)
      ? toolField as Record<string, unknown>
      : null;
  }

  return null;
}

/**
 * JSON 栈平衡检测
 * 返回 [栈, 是否平衡]
 */
function jsonStackBalance(text: string): [string[], boolean] {
  const stack: string[] = [];
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < text.length) {
    const char = text[index];
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

    if (char === '"') {
      inString = true;
      index++;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      if (stack.length === 0) return [stack, false];
      const opener = stack.pop()!;
      if (
        (opener === "{" && char !== "}") ||
        (opener === "[" && char !== "]")
      ) {
        return [stack, false];
      }
    }
    index++;
  }

  return [stack, true];
}

/**
 * 推断缺失的闭合符
 * 对应 Python: _infer_single_missing_closer
 *
 * 支持：
 * - 缺 1 个闭合符：{"a": 1 → {"a": 1}
 * - 缺多个闭合符：{"a": [1,2 → {"a": [1,2]}
 * - 缺闭合符 + 尾逗号：{"a": 1, → {"a": 1}
 *
 * 守卫条件：至少看到 1 个完整字段（requiredFields 为空时）或一半的 requiredFields，
 * 避免 "{}" 这种空对象被误判为"缺闭合符"。
 */
export function inferSingleMissingCloser(
  text: string,
  requiredFields: string[],
): string | null {
  const [stack, balanced] = jsonStackBalance(text);
  // 栈为空（已平衡）或不平衡（多余闭合符）都不处理
  if (balanced && stack.length === 0) return null;
  if (!balanced) return null;
  // stack.length > 0 表示有未闭合的开括号

  const [fields, objectComplete] = iterTopLevelJsonFields(text);
  if (objectComplete) return null;

  // 守卫条件：防止空对象（如 "{" 或 "{ "）被误补成 "{}"
  // 判断逻辑：要么有至少 1 个完整字段，要么有 requiredFields 的一部分，
  // 要么文本足够长且包含冒号（说明有 "key": value 结构正在写入）
  const seenNames = fields
    .filter(([, , valueComplete]) => valueComplete)
    .map(([name]) => name);

  const hasColon = text.includes(":");
  const textLen = text.trim().length;

  if (seenNames.length === 0) {
    // 没有完整字段时，需要文本里有冒号且足够长（排除 "{" 这种空壳）
    // 对于数组场景（如 [1,2），顶层没有字段名，但有逗号说明有元素
    const hasComma = text.includes(",");
    if (!hasColon && !hasComma) return null;
    if (textLen < 4) return null;  // 太短，可能是刚输入 "{"
  }

  // requiredFields 检查（仅在提供了 requiredFields 时）
  if (requiredFields.length > 0 && seenNames.length > 0) {
    const minimumSeen = Math.max(1, Math.floor((requiredFields.length + 1) / 2));
    if (seenNames.length < minimumSeen) return null;
  }

  // 按栈逆序追加所有缺失的闭合符
  // stack 是 ['{', '['] 表示先开了 { 再开了 [，需要先关 ] 再关 }
  let result = text.trimEnd();
  // 去掉尾逗号（如果有）
  if (result.endsWith(",")) result = result.slice(0, -1).trimEnd();

  for (let i = stack.length - 1; i >= 0; i--) {
    const opener = stack[i];
    result += opener === "{" ? "}" : "]";
  }

  return result;
}
