/**
 * JSON 校验管道 —— 对模型输出执行完整验证 + 构建诊断信息。
 * 对应 Python: core/protocol/json_validation.py
 */

import { extractJsonCandidate, findFirstJsonObjectBounds } from "./json-extract.js";
import { iterTopLevelJsonFields } from "./json-scan.js";
import { repairMissingFields, repairPredictField } from "./json-repair.js";
import { normalizeJsonSettings } from "./json-schema.js";
import type { JsonSettings } from "./json-schema.js";

// ── 类型 ──

/** 验证结果 */
export interface ValidationResult {
  valid: boolean;
  canRetry: boolean;
  error: string | null;
  formatted: string | null;
  data: Record<string, unknown> | null;
  diagnostic: Record<string, unknown>;
}

// ── 内部辅助 ──

/** 预览文本（截断显示） */
function previewText(text: string, limit = 180): string {
  const content = (text ?? "").trim();
  if (content.length <= limit) return content;
  return content.slice(0, Math.max(32, limit - 1)) + "\u2026";
}

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

/** 顶层字段诊断 */
function topLevelFieldDiagnostics(
  response: string,
): [Array<{ name: string; value_complete: boolean; raw_preview: string }>, boolean] {
  const [fields, objectComplete] = iterTopLevelJsonFields(response);
  const diagnostics = fields.map(([key, rawValue, valueComplete]) => ({
    name: key,
    value_complete: valueComplete,
    raw_preview: previewText(rawValue, 120),
  }));
  return [diagnostics, objectComplete];
}

// ── 诊断构建 ──

export interface BuildDiagnosticOptions {
  extractedJsonText: string;
  data: Record<string, unknown> | null;
  parseError: Error | null;
  normalizedSettings: JsonSettings;
  validationError: string | null;
  missingFields?: string[];
  actualPredictLength?: number | null;
  repairInfo?: Record<string, unknown> | null;
}

/**
 * 构建验证诊断信息
 * 对应 Python: build_validation_diagnostic
 */
export function buildValidationDiagnostic(
  response: string,
  opts: BuildDiagnosticOptions,
): Record<string, unknown> {
  const rawResponse = response ?? "";
  const extracted = opts.extractedJsonText ?? "";
  const partialCandidate = extractPartialJsonCandidate(rawResponse);
  const [partialFields, partialComplete] = topLevelFieldDiagnostics(rawResponse);

  const repairInfo = opts.repairInfo ?? {};
  let prefix = String(repairInfo.prefix ?? "");
  let suffix = String(repairInfo.suffix ?? "");

  if (!prefix && !suffix && extracted) {
    const bounds = findFirstJsonObjectBounds(rawResponse);
    if (bounds) {
      const [start, end] = bounds;
      prefix = rawResponse.slice(0, start);
      suffix = rawResponse.slice(end);
    } else {
      const braceIndex = rawResponse.indexOf("{");
      if (braceIndex >= 0) {
        prefix = rawResponse.slice(0, braceIndex);
        suffix = partialCandidate
          ? rawResponse.slice(braceIndex + partialCandidate.length)
          : "";
      }
    }
  }

  const parsedKeys =
    opts.data && typeof opts.data === "object" ? Object.keys(opts.data) : [];

  return {
    response_length: rawResponse.length,
    response_preview: previewText(rawResponse, 260),
    extracted_json_length: extracted.length,
    extracted_json_preview: previewText(extracted, 260),
    has_code_fence: rawResponse.includes("```"),
    has_json_prefix_noise: Boolean(prefix.trim()),
    prefix_length: prefix.length,
    prefix_preview: previewText(prefix, 180),
    suffix_length: suffix.length,
    suffix_preview: previewText(suffix, 180),
    partial_candidate_length: partialCandidate.length,
    partial_object_complete: partialComplete,
    top_level_fields_seen: partialFields,
    required_fields: [...(opts.normalizedSettings.required_fields ?? [])],
    parsed_keys: parsedKeys,
    missing_fields: [...(opts.missingFields ?? [])],
    expected_predict_length: opts.normalizedSettings.predict_length ?? 0,
    actual_predict_length: opts.actualPredictLength ?? null,
    parse_error: opts.parseError
      ? { msg: opts.parseError.message, lineno: 0, colno: 0, pos: 0 }
      : null,
    validation_error: opts.validationError ?? "",
    repair: repairInfo,
  };
}

// ── 主入口 ──

/**
 * 验证模型输出并格式化 JSON
 * 对应 Python: validate_and_format_json
 *
 * @param response 模型原始输出文本
 * @param settings json_settings（可选，将被规范化）
 * @returns 验证结果
 */
export function validateParsedResponse(
  response: string,
  settings?: Record<string, unknown> | null,
): ValidationResult {
  const normalizedSettings = normalizeJsonSettings(settings ?? {});
  const extraction = extractJsonCandidate(response, normalizedSettings as unknown as Record<string, unknown>);
  const trimmed = (extraction.candidateText ?? "").trim();

  // 检测 Provider 包装
  if (extraction.providerWrapperDetected) {
    const diagnostic = buildValidationDiagnostic(response, {
      extractedJsonText: trimmed,
      data: null,
      parseError: null,
      normalizedSettings,
      validationError: "检测到 Provider 包装 / 伪工具标签，已拒绝修复",
      repairInfo: extraction as unknown as Record<string, unknown>,
    });
    return {
      valid: false,
      canRetry: true,
      error: "检测到 Provider 包装 / 伪工具标签",
      formatted: null,
      data: null,
      diagnostic,
    };
  }

  // JSON 不完整
  if (!trimmed.endsWith("}")) {
    const diagnostic = buildValidationDiagnostic(response, {
      extractedJsonText: trimmed,
      data: null,
      parseError: null,
      normalizedSettings,
      validationError: "JSON 不完整",
      repairInfo: extraction as unknown as Record<string, unknown>,
    });
    return {
      valid: false,
      canRetry: true,
      error: "JSON 不完整",
      formatted: null,
      data: null,
      diagnostic,
    };
  }

  // JSON 解析
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      const diagnostic = buildValidationDiagnostic(response, {
        extractedJsonText: trimmed,
        data: null,
        parseError: null,
        normalizedSettings,
        validationError: "JSON 解析结果不是对象",
        repairInfo: extraction as unknown as Record<string, unknown>,
      });
      return {
        valid: false,
        canRetry: true,
        error: "JSON 解析结果不是对象",
        formatted: null,
        data: null,
        diagnostic,
      };
    }
    data = parsed as Record<string, unknown>;
  } catch (error) {
    const parseError = error instanceof Error ? error : new Error(String(error));
    const diagnostic = buildValidationDiagnostic(response, {
      extractedJsonText: trimmed,
      data: null,
      parseError,
      normalizedSettings,
      validationError: "JSON 解析失败",
      repairInfo: extraction as unknown as Record<string, unknown>,
    });
    return {
      valid: false,
      canRetry: true,
      error: "JSON 解析失败",
      formatted: null,
      data: null,
      diagnostic,
    };
  }

  // 修复缺失字段
  const [repairedData, repairedFields] = repairMissingFields(
    data,
    normalizedSettings as unknown as Record<string, unknown>,
  );

  const repairInfo: Record<string, unknown> = {
    ...(extraction as unknown as Record<string, unknown>),
  };
  if (repairedFields.length > 0) {
    const existing = Array.isArray(repairInfo.repairs_applied)
      ? (repairInfo.repairs_applied as string[])
      : [];
    repairInfo.repairs_applied = [...existing, "fill_missing_fields"];
    repairInfo.repaired_missing_fields = repairedFields;
  }

  // 修复 predict 字段
  const [finalData, predictRepaired] = repairPredictField(
    repairedData,
    normalizedSettings as unknown as Record<string, unknown>,
  );
  if (predictRepaired) {
    const existing = Array.isArray(repairInfo.repairs_applied)
      ? (repairInfo.repairs_applied as string[])
      : [];
    repairInfo.repairs_applied = [...existing, "repair_predict_shape"];
  }

  // 检查剩余缺失字段
  const missingFields = normalizedSettings.required_fields.filter(
    (field) => !(field in finalData),
  );
  if (missingFields.length > 0) {
    const errorText = `缺少字段: ${missingFields[0]}`;
    const diagnostic = buildValidationDiagnostic(response, {
      extractedJsonText: trimmed,
      data: finalData,
      parseError: null,
      normalizedSettings,
      validationError: errorText,
      missingFields,
      actualPredictLength:
        Array.isArray(finalData.predict) ? finalData.predict.length : null,
      repairInfo,
    });
    return {
      valid: false,
      canRetry: true,
      error: errorText,
      formatted: null,
      data: null,
      diagnostic,
    };
  }

  // 检查 predict 长度
  const expectedPredictLength = normalizedSettings.predict_length;
  if (
    !Array.isArray(finalData.predict) ||
    (finalData.predict as unknown[]).length !== expectedPredictLength
  ) {
    const errorText = `predict 格式错误，应为长度 ${expectedPredictLength}`;
    const diagnostic = buildValidationDiagnostic(response, {
      extractedJsonText: trimmed,
      data: finalData,
      parseError: null,
      normalizedSettings,
      validationError: errorText,
      actualPredictLength:
        Array.isArray(finalData.predict) ? (finalData.predict as unknown[]).length : null,
      repairInfo,
    });
    return {
      valid: false,
      canRetry: true,
      error: errorText,
      formatted: null,
      data: null,
      diagnostic,
    };
  }

  // 验证通过
  const formatted = JSON.stringify(finalData);
  const diagnostic = buildValidationDiagnostic(response, {
    extractedJsonText: formatted,
    data: finalData,
    parseError: null,
    normalizedSettings,
    validationError: "",
    actualPredictLength:
      Array.isArray(finalData.predict) ? (finalData.predict as unknown[]).length : null,
    repairInfo,
  });

  return {
    valid: true,
    canRetry: false,
    error: null,
    formatted,
    data: finalData,
    diagnostic,
  };
}
