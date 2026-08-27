import type { ClipboardParseResult } from "../settings/paste-fill";
import { serializeParseFields } from "../settings/paste-fill";

/** 草稿站无后端时：本地规则识别（不打厂商 /v1/models）。 */
export async function parsePasteLocal(raw: string): Promise<ClipboardParseResult> {
  const { parseClipboard, LLM_PRESET_SCHEMA } = await import(
    "@little-house-studio/llm"
  );
  const result = await parseClipboard(raw, LLM_PRESET_SCHEMA, {
    probeModels: false,
  });
  return {
    fields: serializeParseFields(result.fields),
    needsConfirm: result.needsConfirm,
  };
}
