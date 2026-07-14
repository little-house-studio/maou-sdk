/**
 * 搜索结果增强：抓取页面正文，抽出「释义级」片段
 * 对齐合格搜索工具：SERP 卡片不够，必须有正文证据。
 */

import { curlGet } from "./backends.js";
import { stripHtml } from "./normalize.js";
import type { SearchResult } from "./types.js";

export interface EnrichedResult extends SearchResult {
  /** 从正文抽出的高信息密度句（类似 web_search 的 L 行） */
  excerpts?: string[];
  /** 最佳释义句（优先展示） */
  definition?: string;
  /** 是否成功抓到正文 */
  enriched?: boolean;
}

/** 明显低信息 / 非文章页：不做 enrich 或降权 */
const SKIP_ENRICH_HOST =
  /(^|\.)(douyin|tiktok|iqiyi|youku|v\.qq|music\.163|spotify|apple\.com|google\.com)(\.|$)/i;

const HASHTAG_OR_SEARCH_PATH =
  /\/(hashtag|search|s\?|topic|channel)\b/i;

/** 释义信号（中英） */
const DEF_PATTERNS: RegExp[] = [
  /.{0,40}(是什么梗|什么意思|指的是|谐音|空耳|起源|出处|本义|意思是|译为|即「|即“).{0,80}/g,
  /.{0,20}(戴口罩|听通知|等通知|带手机|健康码).{0,60}/g,
  /梗名[：:].{0,40}/g,
  /.{0,30}(means|refers to|originat).{0,80}/gi,
];

export function isLowValueUrl(url: string, domain?: string): boolean {
  try {
    const u = new URL(url);
    const host = domain || u.hostname;
    if (SKIP_ENRICH_HOST.test(host)) return true;
    if (HASHTAG_OR_SEARCH_PATH.test(u.pathname + u.search)) return true;
    // 纯站内搜索页
    if (/[?&](wd|q|keyword|search_query)=/i.test(u.search) && /search|s\.php/i.test(u.pathname + u.href)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** 是否「释义向」标题 */
export function isDefinitionalTitle(title: string): boolean {
  return /是什么梗|什么意思|谐音|起源|出处|释义|百科|指的是|空耳/.test(title);
}

function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = stripHtml(s);
  return s.replace(/\s+/g, " ").trim();
}

function extractDefinitions(text: string, query: string): { definition?: string; excerpts: string[] } {
  const excerpts: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string, maxLen = 480) => {
    const t = raw.replace(/\s+/g, " ").trim();
    // 允许更长摘要（README 段落）；过短的「a pseudo」级片段直接丢弃
    if (t.length < 28 || t.length > maxLen) return;
    const key = t.slice(0, 48);
    if (seen.has(key)) return;
    seen.add(key);
    excerpts.push(t);
  };

  for (const re of DEF_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null && excerpts.length < 8) {
      push(m[0]);
    }
  }

  // 含 query 关键词的句子
  const qTokens = query
    .replace(/[是什么梗意思啊呢吗？?]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 3);
  if (qTokens.length) {
    const sentences = text.split(/[。！？\n.!?]/).map((s) => s.trim()).filter(Boolean);
    for (const s of sentences) {
      if (excerpts.length >= 10) break;
      if (qTokens.some((t) => s.includes(t)) && s.length >= 16 && s.length <= 200) {
        // 优先含释义词
        if (/谐音|意思|指|空耳|戴口罩|听通知|起源|梗/.test(s)) push(s);
      }
    }
  }

  // 选 definition：同时含「大狗叫」类主体 + 释义词
  let definition: string | undefined;
  for (const e of excerpts) {
    if (/谐音|意思是|指的是|译为|本义|戴口罩|听通知|等通知/.test(e)) {
      definition = e;
      break;
    }
  }
  if (!definition && excerpts[0]) definition = excerpts[0];

  // 释义抽不到时：取正文前几段（GitHub README / 文档常见），避免只剩 SERP 两词摘要
  if (excerpts.length === 0 && text.length >= 40) {
    const paras = text
      .split(/\n{2,}|(?<=[.!?。！？])\s+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 40 && s.length <= 500)
      .slice(0, 4);
    for (const p of paras) push(p, 500);
    if (!definition && excerpts[0]) definition = excerpts[0];
  }

  return { definition, excerpts: excerpts.slice(0, 6) };
}

/** GitHub 仓库页 → 尝试 raw README 正文（比 SERP 摘要有用得多） */
async function tryGithubReadme(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!owner || !repo || repo.includes(".")) {
      // repo 名一般无扩展名；有扩展名可能是 blob 路径，仍试前两段
    }
    const o = owner!;
    const r = repo!.replace(/\.git$/i, "");
    const candidates = [
      `https://raw.githubusercontent.com/${o}/${r}/HEAD/README.md`,
      `https://raw.githubusercontent.com/${o}/${r}/main/README.md`,
      `https://raw.githubusercontent.com/${o}/${r}/master/README.md`,
      `https://raw.githubusercontent.com/${o}/${r}/HEAD/README.MD`,
    ];
    for (const rawUrl of candidates) {
      const body = await curlGet(rawUrl, { timeoutSec: 8, lang: "en-US,en;q=0.9" });
      if (body && body.length >= 80 && !/^404|not found/i.test(body.slice(0, 40))) {
        return body.slice(0, 8000);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 增强单条：抓正文 → 抽释义
 * 超时/失败则保留 SERP snippet，enriched=false
 */
export async function enrichOne(
  r: SearchResult,
  query: string,
): Promise<EnrichedResult> {
  if (isLowValueUrl(r.url, r.domain)) {
    return { ...r, enriched: false, excerpts: r.snippet ? [r.snippet] : [] };
  }

  try {
    // GitHub 仓库优先拉 README
    const readme = await tryGithubReadme(r.url);
    let text = "";
    if (readme) {
      text = readme.replace(/\s+/g, " ").trim().slice(0, 12000);
    } else {
      const html = await curlGet(r.url, {
        lang: "zh-CN,zh;q=0.9,en;q=0.8",
        timeoutSec: 10,
      });
      if (!html || html.length < 400) {
        const snip = (r.snippet || "").trim();
        return {
          ...r,
          enriched: false,
          excerpts: snip.length >= 28 ? [snip.slice(0, 480)] : [],
          snippet: snip.length >= 28 ? snip.slice(0, 480) : snip,
        };
      }
      if (/验证码|captcha|access denied|安全验证|请开启JavaScript/i.test(html.slice(0, 2000))) {
        const snip = (r.snippet || "").trim();
        return {
          ...r,
          enriched: false,
          excerpts: snip.length >= 28 ? [snip.slice(0, 480)] : [],
        };
      }
      text = htmlToText(html).slice(0, 12000);
    }

    const { definition, excerpts } = extractDefinitions(text, query);
    const snip = (r.snippet || "").trim();
    const merged = excerpts.length
      ? excerpts
      : snip.length >= 28
        ? [snip.slice(0, 480)]
        : text.length >= 40
          ? [text.slice(0, 400)]
          : [];

    const best =
      (definition && definition.length >= 28 ? definition : null) ||
      merged[0] ||
      (snip.length >= 28 ? snip : "") ||
      text.slice(0, 400);

    return {
      ...r,
      enriched: true,
      definition: definition && definition.length >= 28 ? definition : best.slice(0, 480),
      excerpts: merged.slice(0, 5),
      snippet: best.slice(0, 480),
    };
  } catch {
    const snip = (r.snippet || "").trim();
    return {
      ...r,
      enriched: false,
      excerpts: snip.length >= 28 ? [snip.slice(0, 480)] : [],
      snippet: snip.slice(0, 480),
    };
  }
}

/** 是否为「可答题」摘要（避免相关搜索词列表误当释义） */
function snippetLooksLikeAnswer(snip: string): boolean {
  if (!snip || snip.length < 20) return false;
  // 相关搜索词堆：多个「什么」短片段
  if ((snip.match(/是什么|什么意思|什么梗/g) || []).length >= 3 && snip.length < 160) {
    return false;
  }
  return (
    /(是|为|即|指).{0,6}(谐音|意思)|谐音.{0,10}(「|“|戴|听)|意思是|指的是|译为|cleanup function|breaking changes?|migration|hard.?link|workspace|auto-?(run|accept)|无需.{0,8}确认|open source (ai )?coding agent|launched on/i.test(
      snip,
    )
  );
}

/** SERP 摘要里已有释义句时，直接升为 definition（不必等正文） */
export function promoteSnippetDefinition(r: SearchResult): EnrichedResult {
  const snip = r.snippet || "";
  if (snippetLooksLikeAnswer(snip)) {
    return {
      ...r,
      definition: snip.slice(0, 280),
      excerpts: [snip.slice(0, 220)],
      enriched: false,
    };
  }
  return {
    ...r,
    enriched: false,
    excerpts: snip ? [snip] : [],
  };
}

/** 并行增强 topK（限制并发，避免打爆） */
export async function enrichTop(
  results: SearchResult[],
  query: string,
  topK = 8,
): Promise<EnrichedResult[]> {
  const head = results.slice(0, topK);
  const tail = results.slice(topK);
  const enriched = await Promise.all(head.map((r) => enrichOne(r, query)));
  // 正文没抽出时，回退用 SERP 释义
  const headDone = enriched.map((r) =>
    r.definition ? r : promoteSnippetDefinition(r),
  );
  return [
    ...headDone,
    ...tail.map((r) => promoteSnippetDefinition(r)),
  ];
}
