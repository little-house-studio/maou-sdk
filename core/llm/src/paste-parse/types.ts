/**
 * 粘贴识别：非结构化文本 → schema 字段。
 * 规则先吃确定字段；认不出就空着，不编。
 */

export type FieldSource = "regex" | "llm" | "ambiguous" | "list";

export type ExtractorId =
  | "phone"
  | "landline"
  | "email"
  | "url"
  | "tracking"
  | "idcard"
  | "name"
  | "address"
  | "province"
  | "city"
  | "district"
  | "postal"
  | "api_key"
  | "base_url"
  | "protocol"
  | "model";

export interface ParsedField {
  value: unknown;
  confidence: number;
  source: FieldSource;
  /** ambiguous 时的候选；model 字段也用来带「同一厂商下的全部模型」 */
  candidates?: string[];
}

export interface PasteFieldSpec {
  name: string;
  type?: "string" | "number" | "boolean";
  description?: string;
  extract?: ExtractorId;
  required?: boolean;
}

export interface PasteSchema {
  id?: string;
  title?: string;
  fields: PasteFieldSpec[];
}

export interface PasteParseResult {
  fields: Record<string, ParsedField>;
  leftovers: string;
  needsConfirm: string[];
}

export interface PasteLlmFill {
  /** 只补空字段。返回字段名 → 值；不要编。 */
  callJson: (system: string, user: string) => Promise<Record<string, unknown> | null>;
}

export interface ParseClipboardOptions {
  llm?: PasteLlmFill;
  /** 低于此置信度进 needsConfirm，默认 0.85 */
  confirmBelow?: number;
  /** 是否用 key+url 拉模型列表，默认 true */
  probeModels?: boolean;
  /** 拉列表超时，默认 2000ms */
  modelListTimeoutMs?: number;
  /** 注入公开模型 id（单测 / 离线）；不传则 models.dev + 内置目录 */
  catalogModelIds?: string[];
  fetchImpl?: (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
}

/** schema 可以是本模块字段表，或宽松 JSON Schema object */
export type ParseClipboardSchema = PasteSchema | Record<string, unknown>;

export type ParseClipboardResult = PasteParseResult;

export interface SpanHit {
  value: string;
  start: number;
  end: number;
  confidence: number;
  extractor: ExtractorId;
  labeled: boolean;
}
