import { extractApiKeys } from "./api-key.js";
import { extractModelGuesses } from "./model-name.js";
import { extractProtocol, extractRequestUrls } from "./request-url.js";
import type { ExtractorId, SpanHit } from "./types.js";

const LABEL: Record<ExtractorId, RegExp> = {
  phone: /(?:手机号?|电话|联系电话|tel|mobile|phone)\s*[:：]?\s*/i,
  landline: /(?:固话|座机)\s*[:：]?\s*/i,
  email: /(?:邮箱|email|e-mail|mail)\s*[:：]?\s*/i,
  url: /(?:网址|链接|url)\s*[:：]?\s*/i,
  tracking: /(?:快递单号|运单号|单号|tracking)\s*[:：]?\s*/i,
  idcard: /(?:身份证号?|id(?:card)?)\s*[:：]?\s*/i,
  name: /(?:收件人|寄件人|姓名|联系人|name)\s*[:：]?\s*/i,
  address: /(?:收货地址|详细地址|地址|address)\s*[:：]?\s*/i,
  province: /(?:省份?)\s*[:：]?\s*/i,
  city: /(?:城市)\s*[:：]?\s*/i,
  district: /(?:区县?|区域)\s*[:：]?\s*/i,
  postal: /(?:邮编|邮政编码|zip)\s*[:：]?\s*/i,
  api_key: /(?:api[_ -]?key|secret[_ -]?key|密钥|token|bearer|authorization)\s*[:：=]?\s*/i,
  base_url: /(?:base[_ -]?url|endpoint|api[_ -]?url|接口(?:地址)?|请求(?:地址|链接))\s*[:：=]?\s*/i,
  protocol: /(?:protocol|协议)\s*[:：=]?\s*/i,
  model: /(?:model(?:[ _-]?id)?|模型)\s*[:：=]?\s*/i,
};

const VALUE: Record<ExtractorId, RegExp> = {
  phone: /(?:\+?86[-\s]*)?(1[3-9]\d(?:[-\s]?\d){8})/,
  landline: /(?:0\d{2,3}-?)?\d{7,8}/,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  url: /https?:\/\/[^\s<>"']+/i,
  tracking: /(?:SF|YT|YD|ZT|ST|JT|HT|YTO|ZTO|STO|JD|EMS)[A-Z0-9]{8,20}|\b[A-Z0-9]{10,20}\b/i,
  idcard: /[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/,
  name: /[A-Za-z\u4e00-\u9fa5·]{1,20}/,
  address: /[^\n;；]{4,200}/,
  province: /[\u4e00-\u9fa5]{2,10}(?:省|自治区|特别行政区|市)/,
  city: /[\u4e00-\u9fa5]{2,12}市/,
  district: /[\u4e00-\u9fa5]{2,12}(?:区|县|旗|市)/,
  postal: /\b\d{6}\b/,
  api_key: /[A-Za-z0-9][A-Za-z0-9_-]{14,}/,
  base_url: /https?:\/\/[^\s<>"']+/i,
  protocol: /[A-Za-z0-9_-]+/,
  model: /[A-Za-z0-9._:/-]{2,80}/,
};

/** 全角数字/标点收成半角，方便规则匹配。 */
export function normalizePasteText(raw: string): string {
  return (raw ?? "")
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/\uFF1A/g, ":")
    .replace(/\u3000/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

function labeledPrefix(text: string, index: number, extractor: ExtractorId): boolean {
  const lookback = text.slice(Math.max(0, index - 24), index);
  return LABEL[extractor].test(lookback);
}

function pushHit(
  hits: SpanHit[],
  extractor: ExtractorId,
  text: string,
  start: number,
  end: number,
  value: string,
  unlabeledConfidence: number,
): void {
  const labeled = labeledPrefix(text, start, extractor);
  hits.push({
    value,
    start,
    end,
    extractor,
    labeled,
    confidence: labeled ? 0.95 : unlabeledConfidence,
  });
}

function scan(
  text: string,
  extractor: ExtractorId,
  body: RegExp,
  unlabeledConfidence: number,
  pick?: (m: RegExpMatchArray) => string,
): SpanHit[] {
  const hits: SpanHit[] = [];
  const re = new RegExp(body.source, body.flags.includes("g") ? body.flags : `${body.flags}g`);
  for (const m of text.matchAll(re)) {
    if (m.index == null) continue;
    const span = m[1] ?? m[0]!;
    const value = (pick ? pick(m) : span).trim().replace(/[，,;；。.\s]+$/, "");
    if (!value) continue;
    const offset = m[0]!.indexOf(span);
    const start = m.index + (offset >= 0 ? offset : 0);
    pushHit(hits, extractor, text, start, start + span.length, value, unlabeledConfidence);
  }
  return hits;
}

export function extractById(text: string, extractor: ExtractorId): SpanHit[] {
  switch (extractor) {
    case "phone":
      return scan(text, "phone", VALUE.phone, 0.93, (m) => (m[1] ?? m[0]!).replace(/\D/g, ""));
    case "landline":
      return scan(text, "landline", VALUE.landline, 0.7).filter((h) => !/^1[3-9]\d{9}$/.test(h.value));
    case "email":
      return scan(text, "email", VALUE.email, 0.94);
    case "url":
    case "base_url":
      return extractRequestUrls(text).map((h) => ({ ...h, extractor }));
    case "protocol":
      return extractProtocol(text);
    case "idcard":
      return scan(text, "idcard", VALUE.idcard, 0.9);
    case "postal":
      return scan(text, "postal", VALUE.postal, 0.72).filter((h) => {
        const around = text.slice(Math.max(0, h.start - 2), h.end + 2);
        return !/1[3-9]\d{9}/.test(around.replace(/\s/g, "")) || labeledPrefix(text, h.start, "postal");
      });
    case "api_key":
      return extractApiKeys(text);
    case "model":
      return extractModelGuesses(text);
    case "name":
      return extractName(text);
    case "address":
      return extractAddress(text);
    case "province":
      return scan(text, "province", VALUE.province, 0.8);
    case "city":
      return scan(text, "city", VALUE.city, 0.75);
    case "district":
      return scan(text, "district", VALUE.district, 0.7);
    case "tracking":
      return scan(text, "tracking", VALUE.tracking, 0.6).filter((h) => {
        if (/^1[3-9]\d{9}$/.test(h.value)) return false;
        if (/^[1-9]\d{17}[\dXx]$/.test(h.value)) return false;
        return h.labeled || /^(SF|YT|YD|ZT|ST|JT|HT|YTO|ZTO|STO|JD|EMS)/i.test(h.value);
      });
    default:
      return [];
  }
}

function scanLabeledThenBare(
  text: string,
  extractor: ExtractorId,
  body: RegExp,
  unlabeledConfidence: number,
): SpanHit[] {
  const labeled: SpanHit[] = [];
  const re = new RegExp(
    `${LABEL[extractor].source}(${body.source})`,
    "gi",
  );
  for (const m of text.matchAll(re)) {
    if (m.index == null || !m[1]) continue;
    const value = m[1].trim();
    const start = m.index + m[0]!.lastIndexOf(m[1]);
    labeled.push({
      value,
      start,
      end: start + m[1].length,
      extractor,
      labeled: true,
      confidence: 0.95,
    });
  }
  if (labeled.length) return labeled;
  return scan(text, extractor, body, unlabeledConfidence);
}

function extractName(text: string): SpanHit[] {
  const labeled = scanLabeledThenBare(text, "name", VALUE.name, 0.55);
  if (labeled.some((h) => h.labeled)) return labeled.filter((h) => h.labeled);

  const phone = extractById(text, "phone")[0];
  if (!phone) return [];
  const before = text.slice(0, phone.start).trim();
  let token = before.split(/[\s,，、;；]+/).filter(Boolean).pop();
  if (!token) return [];
  token = token.replace(/[:：]+$/g, "");
  if (!token || token.length > 8 || token.length < 2) return [];
  if (/[0-9]/.test(token)) return [];
  if (/(省|市|区|县|路|街|号|手机|电话|地址|收件|寄件)/.test(token)) return [];
  const start = text.lastIndexOf(token, phone.start);
  if (start < 0) return [];
  return [
    {
      value: token,
      start,
      end: start + token.length,
      extractor: "name",
      labeled: false,
      confidence: 0.62,
    },
  ];
}

function extractAddress(text: string): SpanHit[] {
  const labeledRe = /(?:收货地址|详细地址|地址|address)\s*[:：]?\s*([^\n;；]{4,200})/gi;
  const labeled: SpanHit[] = [];
  for (const m of text.matchAll(labeledRe)) {
    if (m.index == null || !m[1]) continue;
    const value = m[1].trim();
    const start = m.index + m[0]!.lastIndexOf(m[1]);
    labeled.push({
      value,
      start,
      end: start + m[1].length,
      extractor: "address",
      labeled: true,
      confidence: 0.93,
    });
  }
  if (labeled.length) return labeled;

  const phone = extractById(text, "phone")[0];
  const after = phone ? text.slice(phone.end).trim() : text.trim();
  if (after.length < 6) return [];
  if (!/(省|市|区|县|路|街|道|号|镇|乡|村)/.test(after)) return [];
  const start = phone ? phone.end + text.slice(phone.end).indexOf(after) : text.indexOf(after);
  return [
    {
      value: after.replace(/^[,\s，、;；]+/, ""),
      start,
      end: start + after.length,
      extractor: "address",
      labeled: false,
      confidence: 0.68,
    },
  ];
}

export function peelRegion(address: string): {
  province?: string;
  city?: string;
  district?: string;
  detail?: string;
} {
  let rest = address.trim();
  const out: { province?: string; city?: string; district?: string; detail?: string } = {};

  const prov = rest.match(/^([\u4e00-\u9fa5]{2,10}(?:省|自治区|特别行政区))/);
  if (prov) {
    out.province = prov[1];
    rest = rest.slice(prov[0].length);
  }

  const muni = rest.match(/^(北京|天津|上海|重庆)市?/);
  if (muni) {
    const city = `${muni[1]}市`;
    out.city = city;
    if (!out.province) out.province = city;
    rest = rest.slice(muni[0].length);
  } else {
    const city = rest.match(/^([\u4e00-\u9fa5]{2,12}市)/);
    if (city) {
      out.city = city[1];
      rest = rest.slice(city[0].length);
    }
  }

  const dist = rest.match(/^([\u4e00-\u9fa5]{2,12}(?:区|县|旗))/);
  if (dist) {
    out.district = dist[1];
    rest = rest.slice(dist[0].length);
  }

  rest = rest.replace(/^[,\s，、]+/, "");
  if (rest) out.detail = rest;
  return out;
}

export function punchSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  const marks = Array.from(text, () => false);
  for (const s of spans) {
    for (let i = Math.max(0, s.start); i < Math.min(text.length, s.end); i++) marks[i] = true;
  }
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += marks[i] ? " " : text[i];
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
