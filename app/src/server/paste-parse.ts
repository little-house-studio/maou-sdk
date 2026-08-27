/**
 * 设置页粘贴识别：只填表，不写 config.json。
 */
import { LLM_PRESET_SCHEMA, parseClipboard } from "@little-house-studio/llm";

export type ParsedLlmClipboard = {
  fields: Partial<
    Record<
      "api_key" | "base_url" | "protocol" | "model",
      { value: string; confidence: number; source: string; candidates?: string[] }
    >
  >;
  needsConfirm: string[];
};

const NAMES = ["api_key", "base_url", "protocol", "model"] as const;

export async function parseLlmClipboardText(
  raw: string,
  opts?: { probeModels?: boolean },
): Promise<ParsedLlmClipboard> {
  const result = await parseClipboard(raw, LLM_PRESET_SCHEMA, {
    modelListTimeoutMs: 4000,
    probeModels: opts?.probeModels !== false,
  });
  const fields: ParsedLlmClipboard["fields"] = {};
  for (const name of NAMES) {
    const f = result.fields[name];
    if (!f || f.value == null || f.value === "") continue;
    fields[name] = {
      value: String(f.value),
      confidence: f.confidence,
      source: f.source,
      ...(Array.isArray(f.candidates) && f.candidates.length
        ? { candidates: f.candidates.map(String) }
        : {}),
    };
  }
  return { fields, needsConfirm: result.needsConfirm };
}
