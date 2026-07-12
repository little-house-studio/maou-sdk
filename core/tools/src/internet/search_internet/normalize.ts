/**
 * URL / 标题 / 摘要归一化 + 日期解析
 * 目标：修掉 HTML 抓取带来的假 URL、追踪参数、实体噪声
 */

import type { SearchResult, TimeFilter } from "./types.js";

/** Bing / 搜索页展示串里常见的假 URL 字符 */
const FAKE_URL_MARKERS = /[›»\u00a0]| \u203a | \u00bb /;

/** 常见追踪参数 */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "spm",
  "scm",
  "ved",
  "ei",
  "oq",
  "gs_l",
  "source",
  "si",
]);

/**
 * 解包搜索引擎跳转：
 * - DuckDuckGo: uddg=
 * - Bing 旧: url= / u= 直接是 http URL
 * - Bing 新 ck/a: u=a1 + base64(真实 URL)
 */
function unwrapSearchRedirect(parsed: URL): string | null {
  const candidates = [
    parsed.searchParams.get("uddg"),
    parsed.searchParams.get("url"),
    parsed.searchParams.get("u"),
    parsed.searchParams.get("q"),
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    let v = raw;
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep */
    }
    if (/^https?:\/\//i.test(v) && !v.includes("bing.com/ck")) return v;

    // Bing base64：前缀 a1 / a2 …
    let b64 = v;
    if (/^a\d+/i.test(v) && v.length > 8) {
      b64 = v.replace(/^a\d+/i, "");
    }
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      if (/^https?:\/\//i.test(decoded)) return decoded;
      // 有时 base64 后再 URL-encode
      try {
        const twice = decodeURIComponent(decoded);
        if (/^https?:\/\//i.test(twice)) return twice;
      } catch {
        /* ignore */
      }
    } catch {
      /* not base64 */
    }
  }
  return null;
}

/**
 * Bing/百度等结果页把 URL 显示成「host › path › seg」——还原为 https://host/path/seg
 */
function rebuildCiteUrl(raw: string): string | null {
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/[›»]/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "")
    .trim();
  // 已是正常 URL
  if (/^https?:\/\/[^\s]+$/i.test(cleaned) && !cleaned.includes("›")) {
    return cleaned;
  }
  const m = cleaned.match(/^(https?:\/\/)(.+)$/i);
  if (!m) return null;
  // 折叠多余斜杠
  const rest = m[2].replace(/\/+/g, "/").replace(/\/$/, "");
  if (!rest || rest.endsWith(".")) return null;
  return m[1] + rest;
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/&\w+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 规范化 URL：
 * - 拒绝 cite 展示串（含 › / 空格路径）
 * - 解析 Bing 跳转 /url?q=
 * - 去追踪参数、hash
 * - 强制 https 当原站支持（仅 http 保留）
 */
export function normalizeUrl(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let u = raw.trim();
  if (!u) return null;

  // HTML 实体（Bing 属性里常见 &amp;）
  u = u
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  // cite 展示串：https://github.com › user › repo  → 还原为真实 path
  if (FAKE_URL_MARKERS.test(u) || /https?:\/\/\S+\s+[›»]/.test(u)) {
    const rebuilt = rebuildCiteUrl(u);
    if (!rebuilt) return null;
    u = rebuilt;
  }

  // 协议相对
  if (u.startsWith("//")) u = "https:" + u;

  // 无协议但像域名
  if (!/^https?:\/\//i.test(u)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/:].*)?$/i.test(u)) {
      u = "https://" + u;
    } else {
      return null;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname || parsed.hostname === "localhost") return null;

  // Bing / DDG 跳转解包（含 ck/a 的 base64 u= 参数）
  if (parsed.hostname.includes("bing.com") || parsed.hostname.includes("duckduckgo.com")) {
    const unwrapped = unwrapSearchRedirect(parsed);
    if (unwrapped) return normalizeUrl(unwrapped);
    // 解包失败的搜索引擎跳转链：直接丢弃，避免 domain=bing.com 污染排序
    if (
      parsed.pathname.includes("/ck/") ||
      parsed.pathname.includes("/url") ||
      parsed.searchParams.has("uddg")
    ) {
      return null;
    }
  }

  // 去追踪参数
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.hash = "";

  // 统一 hostname 小写；去掉默认端口
  parsed.hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }

  // trailing slash 统一：仅 path === "/" 保留，其余去尾 /
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 规范化单条结果；失败返回 null（丢弃） */
export function normalizeResult(
  raw: Partial<SearchResult> & { title?: string; url?: string; snippet?: string },
  source: string,
): SearchResult | null {
  const url = normalizeUrl(String(raw.url ?? ""));
  if (!url) return null;

  const title = stripHtml(String(raw.title ?? "")).slice(0, 200);
  if (!title || title.length < 2) return null;

  // 明显垃圾标题
  if (/^(untitled|404|403|access denied|just a moment|attention required)/i.test(title)) {
    return null;
  }

  const snippet = stripHtml(String(raw.snippet ?? "")).slice(0, 320);
  const publishedAt = raw.publishedAt
    ? normalizeDateString(raw.publishedAt)
    : extractDateFromText(`${title} ${snippet}`);

  return {
    title,
    url,
    snippet,
    source: (raw.source as string) || source,
    publishedAt: publishedAt ?? undefined,
    domain: domainOf(url),
  };
}

/** 尝试把各种日期串收成 YYYY-MM-DD 或 ISO */
export function normalizeDateString(s: string): string | undefined {
  const t = s.trim();
  if (!t) return undefined;

  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);

  // unix seconds / ms
  if (/^\d{10,13}$/.test(t)) {
    const n = Number(t);
    const ms = t.length >= 13 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  const d = new Date(t);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2100) {
    return d.toISOString().slice(0, 10);
  }
  return undefined;
}

/**
 * 从标题/摘要抽日期（相对 + 绝对）
 * 覆盖：2026-07-01 / Jul 1, 2026 / 1 天前 / 2 weeks ago / 3 个月前
 */
export function extractDateFromText(text: string): string | undefined {
  if (!text) return undefined;

  // YYYY-MM-DD
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Jul 1, 2026 / July 1 2026
  const en = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  );
  if (en) {
    const d = new Date(`${en[1]} ${en[2]}, ${en[3]}`);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  const now = Date.now();
  // 英文相对
  const enRel = text.match(
    /\b(\d+)\s*(minute|min|hour|hr|day|week|month|year)s?\s*ago\b/i,
  );
  if (enRel) {
    const n = Number(enRel[1]);
    const unit = enRel[2].toLowerCase();
    const ms = relToMs(n, unit);
    if (ms != null) return new Date(now - ms).toISOString().slice(0, 10);
  }

  // 中文相对：1 天前 / 2周前 / 3个月前 / 刚刚
  if (/刚刚|刚才|刚刚发布/.test(text)) {
    return new Date(now).toISOString().slice(0, 10);
  }
  const zhRel = text.match(/(\d+)\s*(分钟|小时|天|日|周|星期|月|年)\s*前/);
  if (zhRel) {
    const n = Number(zhRel[1]);
    const unitMap: Record<string, string> = {
      分钟: "minute",
      小时: "hour",
      天: "day",
      日: "day",
      周: "week",
      星期: "week",
      月: "month",
      年: "year",
    };
    const ms = relToMs(n, unitMap[zhRel[2]] ?? "day");
    if (ms != null) return new Date(now - ms).toISOString().slice(0, 10);
  }

  // 「1 天前」Bing 风格已在上面；再试 2026年7月1日
  const zhAbs = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (zhAbs) {
    const m = zhAbs[2].padStart(2, "0");
    const d = zhAbs[3].padStart(2, "0");
    return `${zhAbs[1]}-${m}-${d}`;
  }

  return undefined;
}

function relToMs(n: number, unit: string): number | null {
  if (!Number.isFinite(n) || n < 0) return null;
  const u = unit.toLowerCase();
  if (u.startsWith("min")) return n * 60_000;
  if (u.startsWith("hour") || u === "hr") return n * 3_600_000;
  if (u.startsWith("day")) return n * 86_400_000;
  if (u.startsWith("week")) return n * 7 * 86_400_000;
  if (u.startsWith("month")) return n * 30 * 86_400_000;
  if (u.startsWith("year")) return n * 365 * 86_400_000;
  return null;
}

/** 时间过滤窗口起点（ms） */
export function timeFilterStartMs(time: TimeFilter): number | null {
  if (!time) return null;
  const now = Date.now();
  const day = 86_400_000;
  switch (time) {
    case "d":
      return now - day;
    case "w":
      return now - 7 * day;
    case "m":
      return now - 30 * day;
    case "y":
      return now - 365 * day;
    default:
      return null;
  }
}

/**
 * 若结果有 publishedAt 且明显超出 time 窗口，标记为过期（排序降权，不直接丢，
 * 因为解析日期可能误伤；极旧且 time=d 时才硬丢）
 */
export function isStaleForFilter(publishedAt: string | undefined, time: TimeFilter): "ok" | "soft" | "hard" {
  if (!time || !publishedAt) return "ok";
  const start = timeFilterStartMs(time);
  if (start == null) return "ok";
  const t = Date.parse(publishedAt.length === 10 ? publishedAt + "T00:00:00Z" : publishedAt);
  if (Number.isNaN(t)) return "ok";
  if (t >= start) return "ok";
  // 超出窗口：d/w 硬降（接近丢弃），m/y 软降
  if (time === "d" || time === "w") return "hard";
  return "soft";
}

/** 去重 key：规范化 host+path（忽略 www 与 query 顺序已在 normalize 处理） */
export function resultKey(r: SearchResult): string {
  try {
    const u = new URL(r.url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname}`.toLowerCase();
  } catch {
    return r.url;
  }
}
