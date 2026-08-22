import { extractById } from "./extractors.js";
import type { ExtractorId, PasteFieldSpec, PasteSchema, SpanHit } from "./types.js";

const NAME_HINT: Array<{ re: RegExp; extract: ExtractorId }> = [
  { re: /^(phone|mobile|tel|cellphone|手机|电话|联系电话)$/i, extract: "phone" },
  { re: /^(landline|固话)$/i, extract: "landline" },
  { re: /^(email|mail|e-mail|邮箱)$/i, extract: "email" },
  { re: /^(url|link|website)$/i, extract: "url" },
  { re: /^(base[_-]?url|endpoint|api[_-]?url|接口)$/i, extract: "base_url" },
  { re: /^(protocol|协议)$/i, extract: "protocol" },
  { re: /^(api[_-]?key|secret|token|key|密钥)$/i, extract: "api_key" },
  { re: /^(model|model[_-]?id|模型)$/i, extract: "model" },
  { re: /^(name|收件人|寄件人|姓名|联系人)$/i, extract: "name" },
  { re: /^(address|addr|detail|详细地址|收货地址|地址)$/i, extract: "address" },
  { re: /^(province|省|省份)$/i, extract: "province" },
  { re: /^(city|市|城市)$/i, extract: "city" },
  { re: /^(district|区|县|区县)$/i, extract: "district" },
  { re: /^(postal|zip|postcode|邮编)$/i, extract: "postal" },
  { re: /^(tracking|express|waybill|单号|快递单号)$/i, extract: "tracking" },
  { re: /^(idcard|id[_-]?no|身份证)$/i, extract: "idcard" },
];

const EXTRACTORS = new Set<ExtractorId>([
  "phone",
  "landline",
  "email",
  "url",
  "tracking",
  "idcard",
  "name",
  "address",
  "province",
  "city",
  "district",
  "postal",
  "api_key",
  "base_url",
  "protocol",
  "model",
]);

function asExtractor(v: unknown): ExtractorId | undefined {
  return typeof v === "string" && EXTRACTORS.has(v as ExtractorId)
    ? (v as ExtractorId)
    : undefined;
}

function inferExtractor(name: string): ExtractorId | undefined {
  const n = name.trim();
  for (const h of NAME_HINT) {
    if (h.re.test(n)) return h.extract;
  }
  return undefined;
}

/** 从本模块 schema 或宽松 JSON Schema object 归一。 */
export function normalizePasteSchema(raw: PasteSchema | Record<string, unknown>): PasteSchema {
  if (raw && Array.isArray((raw as PasteSchema).fields)) {
    return {
      id: (raw as PasteSchema).id,
      title: (raw as PasteSchema).title,
      fields: (raw as PasteSchema).fields.map((f) => ({
        ...f,
        extract: f.extract ?? inferExtractor(f.name),
      })),
    };
  }

  const obj = raw as {
    id?: string;
    title?: string;
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const required = new Set((obj.required ?? []).map(String));
  const props = obj.properties ?? {};
  const fields: PasteFieldSpec[] = Object.entries(props).map(([name, spec]) => {
    const extract =
      asExtractor(spec.extract) ??
      asExtractor(spec["x-extract"]) ??
      inferExtractor(name);
    const t = spec.type;
    return {
      name,
      type: t === "number" || t === "boolean" || t === "string" ? t : "string",
      description: typeof spec.description === "string" ? spec.description : undefined,
      extract,
      required: required.has(name),
    };
  });

  return { id: obj.id, title: obj.title, fields };
}

export interface FieldSpec {
  name: string;
  hint: string;
  extractor?: ExtractorId;
  required: boolean;
  extract: (text: string) => SpanHit[];
}

export function collectFieldSpecs(schema: PasteSchema | Record<string, unknown>): FieldSpec[] {
  const normalized = normalizePasteSchema(schema);
  return normalized.fields.map((f) => ({
    name: f.name,
    hint: f.name,
    extractor: f.extract,
    required: Boolean(f.required),
    extract: (text: string) => (f.extract ? extractById(text, f.extract) : []),
  }));
}
