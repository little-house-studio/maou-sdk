/**
 * JSON 修复管道 —— 修复不完整或缺失字段的 JSON 对象。
 * 包含注释剥离、尾逗号移除、闭合符推断、Schema 默认值推导、缺失字段填充。
 * 对应 Python: core/protocol/json_repair.py + core/tools/utils.py
 */

// ── 工具函数 ──

/** 深拷贝 JSON 值 */
export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 移除 JSON/JSONC 中的注释
 * 对应 Python: core/tools/utils.py strip_json_comments
 */
export function stripJsonComments(text: string): string {
  const result: string[] = [];
  let index = 0;
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < text.length) {
    const char = text[index];
    const nextChar = index + 1 < text.length ? text[index + 1] : "";

    if (inLineComment) {
      if (char === "\r" || char === "\n") {
        inLineComment = false;
        result.push(char);
      }
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
      result.push(char);
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
    }
    result.push(char);
    index++;
  }

  return result.join("");
}

/**
 * 移除 JSON 中的尾逗号
 * 对应 Python: core/tools/utils.py strip_trailing_commas
 */
export function stripTrailingCommas(text: string): string {
  const result: string[] = [];
  let inString = false;
  let escaped = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (inString) {
      result.push(char);
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
      result.push(char);
      index++;
      continue;
    }

    if (char === ",") {
      // 向前看：跳过空白，检查下一个有效字符是否为 } 或 ]
      let lookAhead = index + 1;
      while (lookAhead < text.length && " \t\r\n".includes(text[lookAhead])) {
        lookAhead++;
      }
      if (lookAhead < text.length && (text[lookAhead] === "}" || text[lookAhead] === "]")) {
        // 跳过这个尾逗号
        index++;
        continue;
      }
    }

    result.push(char);
    index++;
  }

  return result.join("");
}

/**
 * 检查值是否为 JSON Schema 对象定义
 * 对应 Python: core/tools/utils.py is_json_schema_object
 */
export function isJsonObjectSchema(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "object" &&
    typeof (value as Record<string, unknown>).properties === "object"
  );
}

/**
 * 剥离 Markdown 围栏
 * 对应 Python: core/tools/utils.py strip_markdown_fence
 */
export function stripMarkdownFence(text: string): string {
  const raw = (text ?? "").trim();
  if (raw.startsWith("```")) {
    const lines = raw.split("\n");
    let result = lines;
    if (result.length > 0) result = result.slice(1);
    if (result.length > 0 && result[result.length - 1].trim() === "```") {
      result = result.slice(0, -1);
    }
    return result.join("\n").trim();
  }
  return raw;
}

// ── Schema 默认值推导 ──

/** 从 JSON Schema 推导默认值 */
function defaultValueFromJsonSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return "";

  const s = schema as Record<string, unknown>;
  if ("default" in s) return cloneJsonValue(s.default);

  if (Array.isArray(s.enum) && s.enum.length > 0) {
    return cloneJsonValue(s.enum[0]);
  }

  let schemaType = s.type;
  if (Array.isArray(schemaType)) {
    const nonNull = schemaType.find((t) => t !== "null");
    schemaType = nonNull ?? (schemaType.length > 0 ? schemaType[0] : "string");
  }

  if (schemaType === "array") {
    let count = 0;
    try {
      count = Math.max(0, parseInt(String(s.minItems ?? 0), 10) || 0);
    } catch {
      count = 0;
    }
    const items = (s.items as Record<string, unknown>) ?? { type: "string" };
    return Array.from({ length: count }, () => defaultValueFromJsonSchema(items));
  }

  if (schemaType === "object") {
    const properties = s.properties;
    if (typeof properties !== "object" || properties === null) return {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      result[key] = defaultValueFromJsonSchema(value);
    }
    return result;
  }

  if (schemaType === "integer" || schemaType === "number") {
    return typeof s.minimum === "number" ? s.minimum : 0;
  }

  if (schemaType === "boolean") return false;

  return "";
}

/** 从 schema_template 推导默认对象 */
function schemaDefaultObject(normalizedSettings: Record<string, unknown>): Record<string, unknown> {
  const schemaTemplate = String(normalizedSettings.schema_template ?? "").trim();
  if (!schemaTemplate) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(schemaTemplate));
  } catch {
    return {};
  }

  if (isJsonObjectSchema(parsed)) {
    const properties = (parsed as Record<string, unknown>).properties;
    if (typeof properties !== "object" || properties === null) return {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      result[key] = defaultValueFromJsonSchema(value);
    }
    return result;
  }

  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

/** 回退默认值 */
function fallbackDefaultForField(field: string, normalizedSettings: Record<string, unknown>): unknown {
  if (field === "predict") {
    const expected = parseInt(String(normalizedSettings.predict_length ?? 0), 10) || 0;
    return expected > 0 ? Array.from({ length: expected }, () => "") : [];
  }
  return "";
}

// ── 修复函数 ──

/**
 * 修复缺失字段
 * 对应 Python: _repair_missing_fields
 */
export function repairMissingFields(
  data: Record<string, unknown>,
  normalizedSettings: Record<string, unknown>,
): [Record<string, unknown>, string[]] {
  const repaired = { ...data };
  const schemaDefaults = schemaDefaultObject(normalizedSettings);
  const repairedFields: string[] = [];

  for (const [key, defaultValue] of Object.entries(schemaDefaults)) {
    if (key in repaired) continue;
    repaired[key] = cloneJsonValue(defaultValue);
    repairedFields.push(key);
  }

  const requiredFields = Array.isArray(normalizedSettings.required_fields)
    ? (normalizedSettings.required_fields as string[])
    : [];
  for (const field of requiredFields) {
    if (field in repaired) continue;
    repaired[field] = fallbackDefaultForField(field, normalizedSettings);
    repairedFields.push(field);
  }

  return [repaired, repairedFields];
}

/**
 * 修复 predict 字段
 * 对应 Python: _repair_predict_field
 */
export function repairPredictField(
  data: Record<string, unknown>,
  normalizedSettings: Record<string, unknown>,
): [Record<string, unknown>, boolean] {
  const expected = parseInt(String(normalizedSettings.predict_length ?? 0), 10) || 0;
  if (expected <= 0) return [data, false];

  const repaired = { ...data };
  const predict = repaired.predict;
  let changed = false;

  if (!Array.isArray(predict)) {
    const schemaDefaults = schemaDefaultObject(normalizedSettings);
    const schemaPredict = schemaDefaults.predict;
    if (Array.isArray(schemaPredict) && schemaPredict.length === expected) {
      repaired.predict = cloneJsonValue(schemaPredict);
    } else {
      repaired.predict = Array.from({ length: expected }, () => "");
    }
    changed = true;
  } else if (predict.length !== expected) {
    const values = predict.slice(0, expected);
    while (values.length < expected) {
      values.push("");
    }
    repaired.predict = values;
    changed = true;
  }

  return [repaired, changed];
}
