/**
 * JSON Schema 派生管道 —— 从规范文件（OUTPUT.jsonc）派生运行时 json_settings。
 * 这是"设计时"路径，只在 Prompt 编译阶段执行一次，不在 Agent 循环中调用。
 * 对应 Python: core/protocol/json_schema.py
 */

import { stripJsonComments, isJsonObjectSchema } from "./json-repair.js";
import { splitFirstJsonObjectRegion } from "./json-extract.js";

// ── 常量 ──

const REQUIRED_FIELDS: readonly string[] = ["expression", "response", "predict"];

const FIELD_DETAIL_SECTION_KEYS: readonly string[] = [
  "键与值详细说明",
  "字段说明",
  "field_details",
  "fieldDescriptions",
];

const FORMAT_SECTION_KEYS: readonly string[] = [
  "输出格式",
  "output_format",
  "outputFormat",
  "schema",
];

const EXAMPLE_SECTION_KEYS: readonly string[] = [
  "输出案例",
  "output_example",
  "outputExample",
  "example",
];

// ── 类型 ──

/** normalize_json_settings 的返回类型 */
export interface JsonSettings {
  required_fields: string[];
  predict_length: number;
  schema_template: string;
  instruction_text: string;
  example_template: string;
}

// ── 内部辅助 ──

/** 检测 prompt 文本中的分区标题 */
function detectSectionHeader(line: string): string | null {
  const cleaned = (line ?? "").trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('"') || cleaned.startsWith("{") || cleaned.startsWith("[")) return null;

  const normalized = cleaned
    .replace(/^\s*(\/\/+|#+|\/\*+|\*+)\s*/, "")
    .replace(/：/g, ":");

  if (/键值详细说明|键与值详细说明|字段说明/.test(normalized)) return "detail";
  if (/输出格式/.test(normalized)) return "format";
  if (/输出案例|输出示例/.test(normalized)) return "example";
  return null;
}

/** 将分区式 prompt 文本拆分为 detail / format / example 三个区段 */
function splitSectionedPromptText(schemaText: string): Record<string, string> | null {
  const sections: Record<string, string[]> = { detail: [], format: [], example: [] };
  let currentSection: string | null = null;
  let foundAny = false;

  for (const line of (schemaText ?? "").split("\n")) {
    const section = detectSectionHeader(line);
    if (section) {
      currentSection = section;
      foundAny = true;
      continue;
    }
    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  if (!foundAny || Object.values(sections).every((arr) => arr.length === 0)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, lines.join("\n").trim()]),
  );
}

/** 剥离行首注释领导符 */
function stripCommentLeader(line: string): string {
  let cleaned = (line ?? "").replace(/\s+$/, "");
  cleaned = cleaned.replace(/^\s*(\/\/+|#+|\/\*+|\*+)\s*/, "");
  cleaned = cleaned.replace(/\s*\*\/\s*$/, "");
  return cleaned.trim();
}

/** 收集非空指令行 */
function collectInstructionLines(text: string): string[] {
  const lines: string[] = [];
  for (const line of (text ?? "").split("\n")) {
    const normalized = stripCommentLeader(line);
    if (normalized) lines.push(normalized);
  }
  return lines;
}

/** 解析必填字段列表，显式列表为空时用 fallbackKeys 减去选填 */
function resolveRequiredFields(
  required: string[],
  optional: Set<string>,
  fallbackKeys: string[],
): string[] {
  if (required.length > 0) return required;
  return fallbackKeys.filter((key) => !optional.has(key));
}

// ── 必填字段提取 ──

/**
 * 从分区式 detail 文本中提取必填字段
 * 行格式: fieldName（必填/选填）: 说明
 */
function extractRequiredFieldsFromSectionedDetailText(
  detailText: string,
  fallbackData: Record<string, unknown>,
): string[] {
  const requiredFields: string[] = [];
  const optionalFields = new Set<string>();

  for (const line of collectInstructionLines(detailText)) {
    const normalized = line.replace(/^\s*[-*]\s*/, "").trim();
    if (!normalized) continue;

    const match = normalized.match(
      /^([A-Za-z0-9_.-]+)\s*(?:（(必填|选填)）|\((required|optional)\))?(?:\s*\[(#[0-9A-Fa-f]{6})\])?\s*[:：]\s*(.+)$/i,
    );
    if (!match) continue;

    const fieldName = (match[1] ?? "").trim();
    const marker = ((match[2] ?? match[3]) ?? "").toLowerCase();
    if (!fieldName) continue;

    if (marker === "选填" || marker === "optional") {
      optionalFields.add(fieldName);
      continue;
    }
    requiredFields.push(fieldName);
  }

  return resolveRequiredFields(requiredFields, optionalFields, Object.keys(fallbackData));
}

/**
 * 从 JSON schema 文本的行内注释中提取必填/选填标记
 * 匹配 "key": value // 必填
 */
function extractRequiredFieldsFromSchema(
  schemaText: string,
  data: Record<string, unknown>,
): string[] {
  const commentedRequired: string[] = [];
  const commentedOptional = new Set<string>();

  for (const line of (schemaText ?? "").split("\n")) {
    const match = line.match(/^\s*"([^"]+)"\s*:\s*.*?(?:\/\/\s*(.*))?$/);
    if (!match) continue;
    const fieldName = (match[1] ?? "").trim();
    if (!fieldName) continue;
    const comment = (match[2] ?? "").trim().toLowerCase();
    if (comment.includes("必填") || comment.includes("required")) {
      commentedRequired.push(fieldName);
    } else if (comment.includes("选填") || comment.includes("optional")) {
      commentedOptional.add(fieldName);
    }
  }

  return resolveRequiredFields(commentedRequired, commentedOptional, Object.keys(data));
}

/** 从 data 中按优先级取第一个存在的映射值 */
function pickFirstMapping(data: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in data) return data[key];
  }
  return null;
}

/** 将多种值类型统一转换为 boolean | null */
function coerceBoolFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Boolean(value);
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "required", "必填"].includes(normalized)) return true;
    if (["false", "0", "no", "optional", "选填"].includes(normalized)) return false;
  }
  return null;
}

/**
 * 从 detail_section 字典中提取必填字段
 * detail_section 可以是 { fieldName: { 必填: true, ... } } 或 { fieldName: "必填: ..." }
 */
function extractRequiredFieldsFromDetailSection(
  detailSection: unknown,
  fallbackData: Record<string, unknown>,
): string[] {
  if (typeof detailSection !== "object" || detailSection === null || Array.isArray(detailSection)) {
    return [];
  }

  const requiredFields: string[] = [];
  const optionalFields = new Set<string>();
  const detail = detailSection as Record<string, unknown>;

  for (const [fieldName, rawDetail] of Object.entries(detail)) {
    const normalizedName = fieldName.trim();
    if (!normalizedName) continue;

    if (typeof rawDetail === "object" && rawDetail !== null && !Array.isArray(rawDetail)) {
      const d = rawDetail as Record<string, unknown>;
      const requiredFlag = coerceBoolFlag(d["必填"] ?? d.required ?? d.is_required);
      const optionalFlag = coerceBoolFlag(d["选填"] ?? d.optional ?? d.is_optional);

      if (requiredFlag === true) {
        requiredFields.push(normalizedName);
        continue;
      }
      if (optionalFlag === true || requiredFlag === false) {
        optionalFields.add(normalizedName);
        continue;
      }
    } else {
      const text = String(rawDetail ?? "");
      if (text.includes("必填") || text.toLowerCase().includes("required")) {
        requiredFields.push(normalizedName);
        continue;
      }
      if (text.includes("选填") || text.toLowerCase().includes("optional")) {
        optionalFields.add(normalizedName);
      }
    }
  }

  if (requiredFields.length > 0) return requiredFields;
  return resolveRequiredFields([], optionalFields, Object.keys(fallbackData));
}

// ── 指令文本渲染 ──

/** 从 detail_section 字典渲染指令文本 */
function renderInstructionTextFromDetailSection(detailSection: unknown): string {
  if (typeof detailSection !== "object" || detailSection === null || Array.isArray(detailSection)) {
    return "";
  }
  const detail = detailSection as Record<string, unknown>;
  if (Object.keys(detail).length === 0) return "";

  const lines = ["键与值详细说明："];
  for (const [fieldName, rawDetail] of Object.entries(detail)) {
    const normalizedName = fieldName.trim();
    if (!normalizedName) continue;

    if (typeof rawDetail === "object" && rawDetail !== null && !Array.isArray(rawDetail)) {
      const d = rawDetail as Record<string, unknown>;
      const requiredFlag = coerceBoolFlag(d["必填"] ?? d.required ?? d.is_required);
      const valueType = String(d["类型"] ?? d.type ?? "").trim();
      const allowedValues = d["可选值"] ?? d.allowed_values ?? d.allowedValues;
      const description = String(d["说明"] ?? d.description ?? "").trim();
      const note = String(d["备注"] ?? d.note ?? "").trim();

      const parts: string[] = [];
      if (requiredFlag === true) parts.push("必填");
      else if (requiredFlag === false) parts.push("选填");
      if (valueType) parts.push(`类型=${valueType}`);
      if (Array.isArray(allowedValues) && allowedValues.length > 0) {
        parts.push("取值=" + allowedValues.map(String).join(" | "));
      }
      if (description) parts.push(description);
      if (note) parts.push(`备注=${note}`);
      lines.push(`- ${normalizedName}：${parts.length > 0 ? parts.join("；") : "见规范文件"}`);
      continue;
    }

    lines.push(`- ${normalizedName}：${String(rawDetail ?? "").trim() || "见规范文件"}`);
  }

  return lines.join("\n");
}

/** 从分区文本块渲染指令文本 */
function renderInstructionTextFromSectionChunks(opts: {
  detailText: string;
  formatLead: string;
  formatTail: string;
  exampleLead: string;
  exampleTail: string;
}): string {
  const lines: string[] = [];

  const detailLines = collectInstructionLines(opts.detailText);
  if (detailLines.length > 0) {
    lines.push("键与值详细说明：");
    for (const line of detailLines) {
      lines.push(line.startsWith("-") || line.startsWith("*") ? line : `- ${line}`);
    }
  }

  for (const chunk of [opts.formatLead, opts.formatTail, opts.exampleLead, opts.exampleTail]) {
    const chunkLines = collectInstructionLines(chunk);
    if (chunkLines.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(...chunkLines);
  }

  return lines.join("\n").trim();
}

// ── Schema 派生 ──

/** 从 JSON Schema 的 predict 属性推导预期数组长度 */
function predictLengthFromJsonSchema(schema: Record<string, unknown>): number {
  const properties =
    typeof schema === "object" && schema !== null
      ? (schema as Record<string, unknown>).properties
      : null;
  const predictSchema =
    typeof properties === "object" && properties !== null
      ? (properties as Record<string, unknown>).predict
      : null;
  if (typeof predictSchema !== "object" || predictSchema === null) return 0;

  const ps = predictSchema as Record<string, unknown>;
  for (const key of ["minItems", "maxItems"]) {
    let value = 0;
    try {
      value = parseInt(String(ps[key] ?? 0), 10) || 0;
    } catch {
      value = 0;
    }
    if (value > 0) return value;
  }
  return 0;
}

/**
 * 规范化 json_settings
 * 对应 Python: normalize_json_settings
 */
export function normalizeJsonSettings(settings: unknown): JsonSettings {
  const payload =
    typeof settings === "object" && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};

  const rawRequired =
    (payload.required_fields as unknown) ||
    (payload.requiredFields as unknown) ||
    REQUIRED_FIELDS;
  const requiredFields = Array.isArray(rawRequired)
    ? rawRequired.map((f) => String(f).trim()).filter(Boolean)
    : [...REQUIRED_FIELDS];

  let predictLength: number;
  try {
    predictLength = parseInt(
      String(payload.predict_length ?? payload.predictLength ?? 3),
      10,
    );
  } catch {
    predictLength = 3;
  }
  if (isNaN(predictLength) || predictLength < 0) predictLength = 3;

  const schemaTemplate = String(
    payload.schema_template ?? payload.schemaTemplate ?? "",
  ).trim();
  const instructionText = String(
    payload.instruction_text ?? payload.instructionText ?? "",
  ).trim();
  const exampleTemplate = String(
    payload.example_template ??
      payload.exampleTemplate ??
      payload.output_example ??
      payload.outputExample ??
      "",
  ).trim();

  return {
    required_fields: requiredFields.length > 0 ? requiredFields : [...REQUIRED_FIELDS],
    predict_length: predictLength,
    schema_template: schemaTemplate,
    instruction_text: instructionText,
    example_template: exampleTemplate,
  };
}

/** 从分区式 prompt 文本派生 json_settings（内部） */
function deriveJsonSettingsFromSectionedPromptText(
  schemaText: string,
): JsonSettings | null {
  const sections = splitSectionedPromptText(schemaText);
  if (!sections) return null;

  const [formatLead, formatObjectText, formatTail] = splitFirstJsonObjectRegion(
    sections.format ?? "",
  );
  const [exampleLead, exampleObjectText, exampleTail] = splitFirstJsonObjectRegion(
    sections.example ?? "",
  );

  if (!formatObjectText.trim()) return null;

  const formatCleaned = stripJsonComments(formatObjectText).trim();
  if (!formatCleaned) {
    throw new Error("JSON 规范文件的\u201C输出格式\u201D分区为空");
  }

  let formatSection: unknown;
  try {
    formatSection = JSON.parse(formatCleaned);
  } catch {
    throw new Error("JSON 规范文件的\u201C输出格式\u201D分区 JSON 解析失败");
  }
  if (
    typeof formatSection !== "object" ||
    formatSection === null ||
    Array.isArray(formatSection)
  ) {
    throw new Error("JSON 规范文件的\u201C输出格式\u201D分区必须是一个对象");
  }
  const fmtObj = formatSection as Record<string, unknown>;

  let exampleSection: Record<string, unknown> | null = null;
  if (exampleObjectText.trim()) {
    const exampleCleaned = stripJsonComments(exampleObjectText).trim();
    if (exampleCleaned) {
      const parsedExample: unknown = JSON.parse(exampleCleaned);
      if (
        typeof parsedExample !== "object" ||
        parsedExample === null ||
        Array.isArray(parsedExample)
      ) {
        throw new Error("JSON 规范文件的\u201C输出案例\u201D分区必须是一个对象");
      }
      exampleSection = parsedExample as Record<string, unknown>;
    }
  }

  let requiredFields: string[];
  let predictLengths: number[];

  if (isJsonObjectSchema(fmtObj)) {
    const rawRequired = Array.isArray(fmtObj.required) ? fmtObj.required : [];
    requiredFields = rawRequired.map((item) => String(item).trim()).filter(Boolean);
    if (requiredFields.length === 0) {
      const props =
        typeof fmtObj.properties === "object" && fmtObj.properties !== null
          ? Object.keys(fmtObj.properties as Record<string, unknown>)
          : [];
      requiredFields = props;
    }
    predictLengths = [predictLengthFromJsonSchema(fmtObj)];
  } else {
    requiredFields = extractRequiredFieldsFromSectionedDetailText(
      sections.detail ?? "",
      fmtObj,
    );
    if (requiredFields.length === 0) {
      requiredFields = extractRequiredFieldsFromSchema(formatObjectText, fmtObj);
    }
    const predictValue = fmtObj.predict;
    predictLengths = Array.isArray(predictValue) ? [predictValue.length] : [];
  }

  if (exampleSection && Array.isArray(exampleSection.predict)) {
    predictLengths.push((exampleSection.predict as unknown[]).length);
  }

  const predictLength = predictLengths.length > 0 ? Math.max(...predictLengths) : 0;

  return normalizeJsonSettings({
    required_fields: requiredFields,
    predict_length: predictLength,
    schema_template: JSON.stringify(fmtObj, null, 2),
    instruction_text: renderInstructionTextFromSectionChunks({
      detailText: sections.detail ?? "",
      formatLead,
      formatTail,
      exampleLead,
      exampleTail,
    }),
    example_template: exampleSection ? JSON.stringify(exampleSection, null, 2) : "",
  });
}

/**
 * 从 schema 文本派生 json_settings —— 主入口
 * 对应 Python: derive_json_settings_from_schema_text
 *
 * 支持两种格式：
 * 1. 分区式 prompt 文本（包含"输出格式"、"输出案例"等标题）
 * 2. 纯 JSON/JSONC 格式的规范文件
 */
export function deriveJsonSettings(schemaText: string): JsonSettings {
  const sectionedSettings = deriveJsonSettingsFromSectionedPromptText(schemaText);
  if (sectionedSettings !== null) return sectionedSettings;

  const cleaned = stripJsonComments(schemaText ?? "").trim();
  if (!cleaned) throw new Error("JSON 规范文件为空");

  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new Error("JSON 规范文件 JSON 解析失败");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("JSON 规范文件必须是一个对象");
  }
  const dataObj = data as Record<string, unknown>;

  const detailSection = pickFirstMapping(dataObj, FIELD_DETAIL_SECTION_KEYS);
  const formatSection = pickFirstMapping(dataObj, FORMAT_SECTION_KEYS);
  const exampleSection = pickFirstMapping(dataObj, EXAMPLE_SECTION_KEYS);

  // format_section 是一个对象
  if (
    typeof formatSection === "object" &&
    formatSection !== null &&
    !Array.isArray(formatSection)
  ) {
    const fmtObj = formatSection as Record<string, unknown>;

    // JSON Schema 形式
    if (isJsonObjectSchema(fmtObj)) {
      const rawRequired = Array.isArray(fmtObj.required) ? fmtObj.required : [];
      let requiredFields = rawRequired.map((item) => String(item).trim()).filter(Boolean);
      if (requiredFields.length === 0) {
        const props =
          typeof fmtObj.properties === "object" && fmtObj.properties !== null
            ? Object.keys(fmtObj.properties as Record<string, unknown>)
            : [];
        requiredFields = props;
      }
      let predictLength = predictLengthFromJsonSchema(fmtObj);
      if (
        predictLength <= 0 &&
        typeof exampleSection === "object" &&
        exampleSection !== null &&
        !Array.isArray(exampleSection) &&
        Array.isArray((exampleSection as Record<string, unknown>).predict)
      ) {
        predictLength = ((exampleSection as Record<string, unknown>).predict as unknown[]).length;
      }
      return normalizeJsonSettings({
        required_fields: requiredFields,
        predict_length: predictLength,
        schema_template: JSON.stringify(fmtObj, null, 2),
        instruction_text: "",
        example_template: "",
      });
    }

    // 非 JSON Schema 对象格式
    let requiredFields = extractRequiredFieldsFromDetailSection(detailSection, fmtObj);
    if (requiredFields.length === 0) {
      requiredFields = extractRequiredFieldsFromSchema(
        JSON.stringify(fmtObj, null, 2),
        fmtObj,
      );
    }

    let predictValue: unknown = fmtObj.predict;
    if (
      !Array.isArray(predictValue) &&
      typeof exampleSection === "object" &&
      exampleSection !== null &&
      !Array.isArray(exampleSection)
    ) {
      predictValue = (exampleSection as Record<string, unknown>).predict;
    }
    const predictLength = Array.isArray(predictValue) ? predictValue.length : 0;

    return normalizeJsonSettings({
      required_fields: requiredFields,
      predict_length: predictLength,
      schema_template: JSON.stringify(fmtObj, null, 2),
      instruction_text: renderInstructionTextFromDetailSection(detailSection),
      example_template:
        typeof exampleSection === "object" &&
        exampleSection !== null &&
        !Array.isArray(exampleSection)
          ? JSON.stringify(exampleSection, null, 2)
          : "",
    });
  }

  // 整个 data 本身是 JSON Schema
  if (isJsonObjectSchema(dataObj)) {
    const rawRequired = Array.isArray(dataObj.required) ? dataObj.required : [];
    let requiredFields = rawRequired.map((item) => String(item).trim()).filter(Boolean);
    if (requiredFields.length === 0) {
      const props =
        typeof dataObj.properties === "object" && dataObj.properties !== null
          ? Object.keys(dataObj.properties as Record<string, unknown>)
          : [];
      requiredFields = props;
    }
    const predictLength = predictLengthFromJsonSchema(dataObj);
    return normalizeJsonSettings({
      required_fields: requiredFields,
      predict_length: predictLength,
      schema_template: JSON.stringify(dataObj, null, 2),
      instruction_text: "",
      example_template: "",
    });
  }

  throw new Error("JSON 规范文件中缺少格式定义");
}
