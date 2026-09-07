/**
 * 粘贴识别 → 设置表单。只填表，不写 config.json。
 */

export const PASTE_FIELDS = ["api_key", "base_url", "protocol", "model"] as const;
export type PasteFieldName = (typeof PASTE_FIELDS)[number];

export type PasteFieldHit = {
  value: string;
  confidence: number;
  source: string;
  /** 同一厂商下一次认出的多个模型 id */
  candidates?: string[];
};

export type ClipboardParseResult = {
  fields: Partial<Record<PasteFieldName, PasteFieldHit>>;
  needsConfirm: string[];
};

export const PASTE_FIELD_LABEL: Record<PasteFieldName, string> = {
  api_key: "Key",
  base_url: "URL",
  protocol: "协议",
  model: "模型",
};

export function fieldValue(
  r: ClipboardParseResult,
  name: PasteFieldName,
): string {
  const v = r.fields[name]?.value;
  return typeof v === "string" ? v.trim() : "";
}

/** 识别出的全部模型 id（首选 + candidates），去重保序。 */
export function modelsFromParse(r: ClipboardParseResult): string[] {
  const f = r.fields.model;
  if (!f) return [];
  const raw = [f.value, ...(f.candidates ?? [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const t = String(item ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function summarizePaste(r: ClipboardParseResult): string {
  const filled = PASTE_FIELDS.filter((k) => fieldValue(r, k));
  if (!filled.length) return "没认出可用字段，表单保持原样";
  const models = modelsFromParse(r);
  const bits = filled.map((k) => {
    const mark = r.needsConfirm.includes(k) ? "请核对" : "已填";
    if (k === "model") {
      const extra = models.length > 1 ? ` ${models.length} 个` : ` ${fieldValue(r, k)}`;
      return `${PASTE_FIELD_LABEL[k]}${extra}（${mark}）`;
    }
    const extra = k === "protocol" ? ` ${fieldValue(r, k)}` : "";
    return `${PASTE_FIELD_LABEL[k]}${extra}（${mark}）`;
  });
  return bits.join(" · ");
}

/** Live / 磁盘协议名 */
export function mapLiveProtocol(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "openai-responses" || s === "cc") return s === "cc" ? "openai" : "responses";
  return s || "openai";
}

export function guessVendorFromProtocol(protocol: string): string {
  const p = mapLiveProtocol(protocol);
  if (p === "anthropic") return "anthropic";
  if (p === "google" || p === "google-vertex") return "google";
  return "openai";
}

export function guessPresetName(url: string, model: string, protocol: string): string {
  const m = model.trim();
  try {
    const host = new URL(url).hostname.replace(/^api\./, "");
    if (host && m) return `${host}/${m}`;
  } catch {
    /* ignore */
  }
  return m ? `${mapLiveProtocol(protocol) || "openai"}/${m}` : "";
}

export function looksAutoPresetName(name: string): boolean {
  const n = name.trim();
  return !n || /^(provider|preset|model)-\d+$/i.test(n);
}

export type LivePastePatch = {
  url?: string;
  keyEdit?: string;
  protocol?: string;
  vendor?: string;
  model?: string;
  name?: string;
};

export function livePatchFromPaste(
  current: { name?: string; url?: string; model?: string },
  parsed: ClipboardParseResult,
): LivePastePatch {
  const url = fieldValue(parsed, "base_url");
  const key = fieldValue(parsed, "api_key");
  const model = fieldValue(parsed, "model");
  const protocol = fieldValue(parsed, "protocol");
  const patch: LivePastePatch = {};
  if (url) patch.url = url;
  if (key) patch.keyEdit = key;
  if (model) patch.model = model;
  if (protocol) {
    patch.protocol = mapLiveProtocol(protocol);
    patch.vendor = guessVendorFromProtocol(protocol);
  }
  const name = guessPresetName(url || current.url || "", model || current.model || "", protocol);
  if (name && looksAutoPresetName(current.name || "")) patch.name = name;
  return patch;
}

export type LivePasteRow = {
  name: string;
  model: string;
  url: string;
  keyEdit: string;
  protocol: string;
  vendor: string;
};

/**
 * 同一 URL/Key 下批量写入模型行：已有 id 跳过，空行先填，其余插到组末。
 */
export function applyLivePasteToRows<T extends LivePasteRow>(input: {
  rows: T[];
  selected: number;
  groupIndices: number[];
  parsed: ClipboardParseResult;
  uniqueName: (base: string, existing: string[]) => string;
  seedRow: () => T;
}): { rows: T[]; selected: number } {
  const current = input.rows[input.selected];
  const patch = livePatchFromPaste(current ?? {}, input.parsed);
  const models = modelsFromParse(input.parsed);
  const conn = {
    ...(patch.url ? { url: patch.url } : {}),
    ...(patch.keyEdit ? { keyEdit: patch.keyEdit } : {}),
    ...(patch.protocol ? { protocol: patch.protocol } : {}),
    ...(patch.vendor ? { vendor: patch.vendor } : {}),
  } as Partial<T>;

  if (input.rows.length === 0) {
    const ids = models.length ? models : patch.model ? [patch.model] : [""];
    const names: string[] = [];
    const rows = ids.map((m, i) => {
      const base = { ...input.seedRow(), ...conn, model: m } as T;
      const hint = guessPresetName(base.url, m, base.protocol) || `model-${i + 1}`;
      const name = input.uniqueName(hint, names);
      names.push(name);
      return { ...base, name };
    });
    return { rows, selected: 0 };
  }

  const selected = Math.min(Math.max(0, input.selected), input.rows.length - 1);
  const gi = input.groupIndices.length ? [...input.groupIndices] : [selected];
  const start = Math.min(...gi);
  const end = Math.max(...gi);
  const head = input.rows.slice(0, start).map((r) => ({ ...r }));
  const tail = input.rows.slice(end + 1).map((r) => ({ ...r }));
  const group = input.rows.slice(start, end + 1).map((r) => ({ ...r, ...conn }));

  if (!models.length) {
    if (patch.model) {
      const i = Math.min(Math.max(0, selected - start), group.length - 1);
      const row = group[i]!;
      group[i] = {
        ...row,
        model: patch.model,
        name:
          patch.name && looksAutoPresetName(row.name)
            ? input.uniqueName(patch.name, [...head, ...group, ...tail].map((r) => r.name))
            : row.name,
      };
    }
    return { rows: [...head, ...group, ...tail], selected };
  }

  const namesOf = (rows: T[]) => rows.map((r) => r.name);
  const have = new Set(group.map((r) => r.model.trim().toLowerCase()).filter(Boolean));
  const out = group.map((r) => ({ ...r }));

  for (const m of models) {
    const k = m.toLowerCase();
    if (have.has(k)) continue;
    const emptyAt = out.findIndex((r) => !r.model.trim());
    if (emptyAt >= 0) {
      const row = out[emptyAt]!;
      const hint = guessPresetName(row.url, m, row.protocol);
      out[emptyAt] = {
        ...row,
        model: m,
        name: looksAutoPresetName(row.name)
          ? input.uniqueName(hint || row.name, namesOf([...head, ...out, ...tail]))
          : row.name,
      };
      have.add(k);
      continue;
    }
    const base = out[0]!;
    const hint = guessPresetName(base.url, m, base.protocol);
    const name = input.uniqueName(hint || m, namesOf([...head, ...out, ...tail]));
    out.push({ ...base, model: m, name });
    have.add(k);
  }

  const primary = models[0]!;
  const local = out.findIndex((r) => r.model.trim().toLowerCase() === primary.toLowerCase());
  return {
    rows: [...head, ...out, ...tail],
    selected: start + Math.max(0, local),
  };
}

export function serializeParseFields(
  fields: Record<
    string,
    { value?: unknown; confidence?: number; source?: string; candidates?: string[] } | undefined
  >,
): ClipboardParseResult["fields"] {
  const out: ClipboardParseResult["fields"] = {};
  for (const name of PASTE_FIELDS) {
    const f = fields[name];
    if (!f || f.value == null || f.value === "") continue;
    const hit: PasteFieldHit = {
      value: String(f.value),
      confidence: typeof f.confidence === "number" ? f.confidence : 0,
      source: typeof f.source === "string" ? f.source : "regex",
    };
    if (Array.isArray(f.candidates) && f.candidates.length) {
      hit.candidates = f.candidates.map(String);
    }
    out[name] = hit;
  }
  return out;
}
