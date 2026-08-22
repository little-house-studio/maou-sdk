import type { FieldSpec } from "./schema.js";
import type { ParsedField, PasteLlmFill } from "./types.js";

const PROTECT = 0.85;

function shouldAsk(field: ParsedField | undefined): boolean {
  if (!field) return true;
  if (field.value == null || field.value === "") return true;
  if (field.source === "ambiguous") return true;
  return field.confidence < PROTECT;
}

function asFillValue(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || t === "null" || t === "undefined") return undefined;
    return t;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  return undefined;
}

/** 只补空 / 低置信度字段。绝不覆盖高置信度 regex。 */
export async function fillLowConfidenceWithLlm(
  fields: Record<string, ParsedField>,
  specs: FieldSpec[],
  leftovers: string,
  llm: PasteLlmFill,
): Promise<void> {
  const missing = specs.filter((s) => shouldAsk(fields[s.name]));
  if (!missing.length) return;

  const keys = missing.map((s) => s.name);
  const system = [
    "从用户粘贴残留文本里抽取表单字段。",
    `只返回 JSON 对象，键只能是：${keys.join(", ")}。`,
    "认不准就省略该键或填 null，不要编造。",
    "不要解释。",
  ].join("\n");
  const user = leftovers.trim() || "(无残留文本)";

  let json: Record<string, unknown> | null = null;
  try {
    json = await llm.callJson(system, user);
  } catch {
    return;
  }
  if (!json || typeof json !== "object") return;

  for (const spec of missing) {
    const existing = fields[spec.name];
    if (existing?.source === "regex" && existing.confidence >= PROTECT) continue;
    const next = asFillValue(json[spec.name]);
    if (next === undefined) continue;
    fields[spec.name] = {
      value: next,
      confidence: 0.7,
      source: "llm",
    };
  }
}
