/**
 * 把 LLM 预设表单写成 config.json。
 *
 * 粘贴识别本身只填表，不落盘。表单确认后调这个；
 * 也可以跳过审核直接写（认不全时仍可能写出不完整名单）。
 */

import type { APIPreset } from "../adapters/types.js";
import { upsertApiPreset, type GlobalApiWriteOptions } from "../api-presets.js";
import { DEFAULT_PROTOCOL } from "./request-url.js";
import type { ParsedField, ParseClipboardResult } from "./types.js";

export interface LlmPresetFormValues {
  name?: string;
  api_key?: string;
  key?: string;
  base_url?: string;
  url?: string;
  protocol?: string;
  model?: string;
}

export type LlmPresetApplyInput =
  | ParseClipboardResult
  | Record<string, ParsedField>
  | LlmPresetFormValues;

export type LlmPresetBuildResult =
  | { ok: true; preset: APIPreset }
  | { ok: false; reason: string };

export type LlmPresetApplyResult =
  | { ok: true; path: string; preset: APIPreset }
  | { ok: false; reason: string };

function isParsedField(v: unknown): v is ParsedField {
  return Boolean(v && typeof v === "object" && "value" in v && "source" in v);
}

function flattenFields(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = isParsedField(v) ? v.value : v;
  }
  return out;
}

function asFlat(input: LlmPresetApplyInput): Record<string, unknown> {
  if (input && typeof input === "object" && "fields" in input) {
    const fields = (input as ParseClipboardResult).fields;
    if (fields && typeof fields === "object") return flattenFields(fields as Record<string, unknown>);
  }
  return flattenFields(input as Record<string, unknown>);
}

function pickStr(rec: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v != null && (typeof v === "number" || typeof v === "boolean")) return String(v);
  }
  return "";
}

function defaultPresetName(url: string, model: string, protocol: string): string {
  try {
    const host = new URL(url).hostname.replace(/^api\./, "");
    if (host) return `${host}/${model}`;
  } catch {
    /* ignore */
  }
  return `${protocol}/${model}`;
}

/** 表单值 / 粘贴结果 → APIPreset。不写盘。缺 url 或 model 则失败。 */
export function llmPresetFromFields(
  input: LlmPresetApplyInput,
  opts?: { name?: string },
): LlmPresetBuildResult {
  const rec = asFlat(input);
  const url = pickStr(rec, "base_url", "url");
  const model = pickStr(rec, "model");
  if (!url) return { ok: false, reason: "缺少 base_url" };
  if (!model) return { ok: false, reason: "缺少 model" };

  const protocol = pickStr(rec, "protocol") || DEFAULT_PROTOCOL;
  const key = pickStr(rec, "api_key", "key") || undefined;
  const name = (opts?.name?.trim() || pickStr(rec, "name") || defaultPresetName(url, model, protocol));

  const preset: APIPreset = {
    name,
    model,
    url,
    protocol,
  };
  if (key) preset.key = key;
  return { ok: true, preset };
}

/** 可选落盘：把表单（或未审核的粘贴结果）写入 config.json api.presets。 */
export function applyLlmPresetToConfig(
  input: LlmPresetApplyInput,
  opts?: {
    name?: string;
    configPath?: string;
    roles?: GlobalApiWriteOptions["roles"];
  },
): LlmPresetApplyResult {
  const built = llmPresetFromFields(input, { name: opts?.name });
  if (!built.ok) return built;
  const path = upsertApiPreset(built.preset, {
    configPath: opts?.configPath,
    roles: opts?.roles,
  });
  return { ok: true, path, preset: built.preset };
}
