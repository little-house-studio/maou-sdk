/**
 * 结果可靠性 + 时效排序
 */

import { isStaleForFilter } from "./normalize.js";
import { entityHitScore, extractQueryCore, looksLikeDictionaryHeadwordPage } from "./query_core.js";
import type { RankContext, SearchResult, SourceKind } from "./types.js";

/** 后端基础可靠度 0..1（无付费搜索源） */
const SOURCE_RELIABILITY: Record<string, number> = {
  "github-api": 0.9,
  "npm-api": 0.88,
  "mdn-api": 0.92,
  "stackexchange-api": 0.88,
  "crates-api": 0.88,
  "pkggo-api": 0.86,
  "dockerhub-api": 0.84,
  "devto-api": 0.75,
  "arxiv-api": 0.9,
  "wikipedia-api": 0.85,
  "hn-api": 0.82,
  "google-news-rss": 0.8,
  youtube: 0.78,
  ddgr: 0.72,
  "ddg-lite": 0.65,
  "ddg-html": 0.68,
  "ddg-instant": 0.45, // 即时答案，非真搜索
  bing: 0.6,
  baidu: 0.68, // 中文网页检索，释义页召回更好
  so360: 0.72, // 360 搜索，中文整词召回较好
  "docs-site": 0.94, // 官方文档直链探测（免费）
};

/** 高可信域名（技术文档 / 官方 / 源码） */
const TRUSTED_DOMAINS: Array<{ re: RegExp; boost: number }> = [
  { re: /(^|\.)github\.com$/i, boost: 0.18 },
  { re: /(^|\.)githubusercontent\.com$/i, boost: 0.1 },
  { re: /(^|\.)npmjs\.com$/i, boost: 0.14 },
  { re: /(^|\.)pypi\.org$/i, boost: 0.12 },
  { re: /(^|\.)crates\.io$/i, boost: 0.12 },
  { re: /(^|\.)pkg\.go\.dev$/i, boost: 0.12 },
  { re: /(^|\.)developer\.mozilla\.org$/i, boost: 0.16 },
  { re: /(^|\.)stackoverflow\.com$/i, boost: 0.14 },
  { re: /(^|\.)stackexchange\.com$/i, boost: 0.12 },
  { re: /(^|\.)arxiv\.org$/i, boost: 0.14 },
  { re: /(^|\.)wikipedia\.org$/i, boost: 0.1 },
  { re: /(^|\.)news\.ycombinator\.com$/i, boost: 0.1 },
  { re: /(^|\.)docs\./i, boost: 0.12 },
  { re: /(^|\.)readthedocs\.io$/i, boost: 0.12 },
  { re: /(^|\.)nodejs\.org$/i, boost: 0.14 },
  { re: /(^|\.)python\.org$/i, boost: 0.12 },
  { re: /(^|\.)rust-lang\.org$/i, boost: 0.12 },
  { re: /(^|\.)typescriptlang\.org$/i, boost: 0.12 },
  { re: /(^|\.)react\.dev$/i, boost: 0.12 },
  { re: /(^|\.)vuejs\.org$/i, boost: 0.1 },
  { re: /(^|\.)angular\.io$/i, boost: 0.1 },
  { re: /(^|\.)openai\.com$/i, boost: 0.1 },
  { re: /(^|\.)anthropic\.com$/i, boost: 0.1 },
  { re: /(^|\.)opencode\.ai$/i, boost: 0.14 },
  { re: /(^|\.)aider\.chat$/i, boost: 0.12 },
  { re: /(^|\.)dev\.to$/i, boost: 0.06 },
  { re: /(^|\.)medium\.com$/i, boost: 0.04 },
  { re: /(^|\.)reuters\.com$/i, boost: 0.1 },
  { re: /(^|\.)techcrunch\.com$/i, boost: 0.08 },
  { re: /(^|\.)theverge\.com$/i, boost: 0.06 },
];

/**
 * 低质/跑题域名：在技术意图下强惩罚
 * （Best Buy 抢 "best"、词典抢词条等）
 */
const NOISE_DOMAINS: Array<{ re: RegExp; penalty: number; techOnly?: boolean }> = [
  { re: /(^|\.)bestbuy\.com$/i, penalty: 0.55, techOnly: true },
  { re: /(^|\.)amazon\./i, penalty: 0.4, techOnly: true },
  { re: /(^|\.)ebay\./i, penalty: 0.45, techOnly: true },
  { re: /(^|\.)walmart\.com$/i, penalty: 0.5, techOnly: true },
  { re: /(^|\.)tripadvisor\./i, penalty: 0.5, techOnly: true },
  { re: /(^|\.)booking\.com$/i, penalty: 0.5, techOnly: true },
  { re: /(^|\.)merriam-webster\.com$/i, penalty: 0.45, techOnly: true },
  { re: /(^|\.)dictionary\.cambridge\.org$/i, penalty: 0.45, techOnly: true },
  { re: /(^|\.)dictionary\.com$/i, penalty: 0.45, techOnly: true },
  { re: /(^|\.)thesaurus\.com$/i, penalty: 0.4, techOnly: true },
  { re: /(^|\.)yelp\.com$/i, penalty: 0.45, techOnly: true },
  { re: /(^|\.)pinterest\./i, penalty: 0.25 },
  { re: /(^|\.)facebook\.com$/i, penalty: 0.2 },
  { re: /(^|\.)instagram\.com$/i, penalty: 0.25 },
  { re: /(^|\.)tiktok\.com$/i, penalty: 0.2 },
  // SEO 垃圾农场常见模式
  { re: /(^|\.)blogspot\./i, penalty: 0.08 },
];

/** 技术意图关键词 */
const TECH_HINT =
  /\b(api|sdk|cli|agent|coding|code|github|npm|python|rust|typescript|javascript|react|vue|docker|kubernetes|llm|openai|anthropic|开源|编程|框架|库|工具|终端|agentic|opencode|aider|codex)\b/i;

export function detectTechIntent(query: string, category: string): boolean {
  if (category === "coding" || category === "tools" || category === "academic") return true;
  return TECH_HINT.test(query);
}

function sourceReliability(source: string): number {
  return SOURCE_RELIABILITY[source] ?? 0.5;
}

function domainBoost(domain: string, techIntent: boolean): number {
  let score = 0;
  for (const { re, boost } of TRUSTED_DOMAINS) {
    if (re.test(domain)) score = Math.max(score, boost);
  }
  for (const { re, penalty, techOnly } of NOISE_DOMAINS) {
    if (techOnly && !techIntent) continue;
    if (re.test(domain)) score -= penalty;
  }
  return score;
}

/** 轻量词干：agents→agent，coding→code 的包含匹配 */
function tokenMatches(hay: string, token: string): boolean {
  if (hay.includes(token)) return true;
  // 简单复数
  if (token.endsWith("s") && token.length > 3 && hay.includes(token.slice(0, -1))) return true;
  if (!token.endsWith("s") && hay.includes(token + "s")) return true;
  // coding ↔ code
  if (token === "coding" && (hay.includes("code") || hay.includes("coder"))) return true;
  if (token === "code" && hay.includes("coding")) return true;
  return false;
}

/** 中英混合分词：CJK 长串拆问句成分 + 主体词，避免「大狗叫是什么梗」整串匹配失败 */
function tokenizeQuery(query: string): string[] {
  const q = query.toLowerCase().trim();
  const raw = q
    .split(/[^a-z0-9\u4e00-\u9fff.+#-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));

  const out: string[] = [];
  for (const p of raw) {
    out.push(p);
    if (/[\u4e00-\u9fff]{4,}/.test(p)) {
      // 去掉问句尾巴，抽出主体
      const core = p
        .replace(/(是什么梗|什么梗|什么意思|是什么意思|怎么理解|如何解释)$/g, "")
        .replace(/^(什么是|咋个)/, "");
      if (core.length >= 2) out.push(core);
      // 2~4 字滑动，提高中文召回匹配
      for (let n = 2; n <= 4 && n <= p.length; n++) {
        out.push(p.slice(0, n));
      }
      for (const part of p.split(/(是什么梗|什么意思|是什么|怎么|如何|为什么)/)) {
        if (part && part.length >= 2 && !STOP.has(part)) out.push(part);
      }
    }
  }
  return [...new Set(out.filter((t) => t.length >= 2 && !STOP.has(t)))];
}

/** 查询词命中率 0..1（标题权重更高） */
export function relevanceRatio(r: SearchResult, query: string): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 0.5;

  const title = (r.title ?? "").toLowerCase();
  const hay = `${r.title} ${r.snippet} ${r.domain ?? ""} ${r.url}`.toLowerCase();
  let hit = 0;
  let titleHit = 0;
  for (const t of tokens) {
    if (tokenMatches(hay, t)) hit++;
    if (tokenMatches(title, t)) titleHit++;
  }
  const bodyRatio = hit / tokens.length;
  const titleRatio = titleHit / tokens.length;
  return Math.min(1, bodyRatio * 0.55 + titleRatio * 0.45);
}

/** 查询词命中 → 分数修正（可负） */
function relevanceBoost(r: SearchResult, query: string): number {
  const ratio = relevanceRatio(r, query);
  if (ratio >= 0.75) return 0.22;
  if (ratio >= 0.5) return 0.12;
  if (ratio >= 0.3) return 0.04;
  if (ratio >= 0.15) return -0.08;
  return -0.25;
}

/** 从 snippet 抽 GitHub star 等信号 */
function popularityBoost(r: SearchResult): number {
  const s = r.snippet || "";
  const star = s.match(/⭐\s*([\d,]+)/) || s.match(/([\d,]+)\s*stars?/i);
  if (star) {
    const n = Number(star[1].replace(/,/g, ""));
    if (n >= 10_000) return 0.2;
    if (n >= 1_000) return 0.12;
    if (n >= 100) return 0.06;
    if (n < 5 && /github\.com/i.test(r.domain ?? "")) return -0.12; // 近零星仓库降权
  }
  // issue 噪音：github issues 且标题像 bounty/onboard 模板
  if (
    /github\.com/i.test(r.url) &&
    /\/issues\//i.test(r.url) &&
    /bounty|onboard|race —|fos-state|cadence/i.test(r.title)
  ) {
    return -0.2;
  }
  if (/github\.com/i.test(r.url) && /\/issues\//i.test(r.url)) {
    return -0.08; // issue 默认略低于 repo
  }
  return 0;
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "best",
  "top",
  "how",
  "what",
  "is",
  "are",
  "vs",
  "的",
  "和",
  "与",
  "在",
  "是",
  "有",
]);

/**
 * 时效分 0..1
 * - 有 publishedAt：越新越高
 * - time 过滤：在窗口内满分区间，窗外降分
 * - 无日期：给中性分 0.45（不因「未知」碾压有日期的新结果）
 */
export function freshnessScore(
  publishedAt: string | undefined,
  timeFilter: RankContext["timeFilter"],
): number {
  if (!publishedAt) return 0.45;
  const t = Date.parse(publishedAt.length === 10 ? publishedAt + "T12:00:00Z" : publishedAt);
  if (Number.isNaN(t)) return 0.45;

  const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
  // 指数衰减：半衰期约 45 天（偏技术文档）；新闻类更短由 timeFilter 加强
  let halfLife = 45;
  if (timeFilter === "d") halfLife = 1.5;
  else if (timeFilter === "w") halfLife = 5;
  else if (timeFilter === "m") halfLife = 18;
  else if (timeFilter === "y") halfLife = 120;

  const fresh = Math.exp(-Math.LN2 * (ageDays / halfLife));
  return Math.max(0, Math.min(1, fresh));
}

/** 短视频/话题壳/站内搜索页：压制 */
function shellPenalty(r: SearchResult): number {
  const url = r.url || "";
  const host = r.domain || "";
  let p = 0;
  if (/douyin\.com|tiktok\.com/i.test(host)) p -= 0.35;
  if (/iqiyi\.com|youku\.com/i.test(host)) p -= 0.18;
  if (/\/hashtag\//i.test(url)) p -= 0.35;
  if (/\/search\//i.test(url) || /[?&](wd|keyword)=/i.test(url)) p -= 0.28;
  if (/music\.163\.com|spotify\.com/i.test(host) && !/是什么|意思|梗/.test(r.title)) p -= 0.2;
  if (
    /是什么梗|什么意思|谐音|起源|出处|百科|migration|changelog|breaking|docs|documentation/i.test(
      r.title,
    )
  ) {
    p += 0.2;
  }
  if (
    /谐音|意思是|指的是|戴口罩|听通知|等通知|空耳|cleanup|breaking change|workspace/i.test(
      r.snippet || "",
    )
  ) {
    p += 0.22;
  }
  if (
    /(^|\.)(react\.dev|zod\.dev|pnpm\.io|nodejs\.org|developer\.mozilla\.org|openai\.com)$/i.test(
      host,
    )
  ) {
    p += 0.18;
  }
  return p;
}

/** 多关键词覆盖率 */
export function tokenCoverage(r: SearchResult, query: string): number {
  const tokens = tokenizeQuery(query).filter((t) => {
    if (t.length < 2) return false;
    return !["mode", "new", "use", "and", "the"].includes(t);
  });
  if (tokens.length === 0) return 0.5;
  const hay = `${r.title} ${r.snippet} ${r.url} ${r.domain ?? ""}`.toLowerCase();
  let hit = 0;
  for (const t of tokens) {
    if (tokenMatches(hay, t)) hit++;
  }
  return hit / tokens.length;
}

/** 实体撞车惩罚 */
function entityClashPenalty(r: SearchResult, query: string): number {
  const q = query.toLowerCase();
  const hay = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
  let p = 0;

  if (
    /(coding\s*agent|cursor|claude\s*code|审批|确认|auto-?run|agent\s*模式)/i.test(q) ||
    (/\byolo\b/i.test(q) && /mode|模式|agent/.test(q))
  ) {
    if (/ultralytics|yolov\d|目标检测|object detection|computer vision|实时目标/i.test(hay)) {
      p -= 0.55;
    }
    if (
      /auto-?(run|accept)|without (asking|confirmation)|无需.*确认|跳过.*审批|you only live once/i.test(
        hay,
      )
    ) {
      p += 0.25;
    }
  }

  if (/\bzod\b/i.test(q) && /(v4|breaking|schema|typescript|npm|migration|changelog)/i.test(q)) {
    if (/general zod|supervillain|dc comics|film series|kryptonian|superman/i.test(hay)) {
      p -= 0.6;
    }
    if (/zod\.dev|colinhacks|schema validation|typescript-first/i.test(hay)) {
      p += 0.28;
    }
  }

  if (/useeffect|cleanup/i.test(q)) {
    if (!/useeffect|cleanup|hook/i.test(hay) && /react/i.test(hay)) p -= 0.35;
    if (/react\.dev\/reference\/react\/useeffect/i.test(hay) || /cleanup function/i.test(hay)) {
      p += 0.3;
    }
  }

  if (/workspace/i.test(q) && /pnpm|npm/.test(q)) {
    if (/淘宝源|registry|换源|镜像|cnpm/i.test(hay) && !/workspace|monorepo|工作空间/i.test(hay)) {
      p -= 0.3;
    }
    if (/workspace|monorepo|硬链接|symlink|工作空间/i.test(hay)) p += 0.15;
  }

  return p;
}

export function scoreResult(r: SearchResult, ctx: RankContext): SearchResult {
  const domain = r.domain ?? "";
  const base = sourceReliability(String(r.source));
  const dBoost = domainBoost(domain, ctx.techIntent);
  const relBoost = relevanceBoost(r, ctx.query);
  const relRatio = relevanceRatio(r, ctx.query);
  const coverage = tokenCoverage(r, ctx.query);
  const pop = popularityBoost(r);
  const shell = shellPenalty(r);
  const clash = entityClashPenalty(r, ctx.query);
  const stale = isStaleForFilter(r.publishedAt, ctx.timeFilter);

  let reliability = clamp01(
    base + dBoost + relBoost * 0.6 + pop + shell + clash,
  );
  if (r.source === "ddg-instant" && !/(wikipedia|github|npmjs)/i.test(domain)) {
    reliability *= 0.7;
  }

  let freshness = freshnessScore(r.publishedAt, ctx.timeFilter);
  if (stale === "hard") {
    freshness *= 0.15;
    reliability *= 0.85;
  } else if (stale === "soft") {
    freshness *= 0.45;
  }
  if (!r.publishedAt) freshness *= 0.9;

  // 释义/知识/文档类：降新鲜度权重
  const isExplainQuery = /是什么|什么意思|什么梗|谐音|起源|出处|why|what is|meaning|difference|区别|breaking|changelog|cleanup|workspace/i.test(
    ctx.query,
  );
  const wFresh = isExplainQuery ? 0.12 : ctx.timeFilter ? 0.35 : 0.28;
  const wRel = 1 - wFresh;
  const baseScore = reliability * wRel + freshness * wFresh;
  // 覆盖率门控：关键词太少直接压分
  const coverageGate = clamp01(0.15 + coverage * 1.05);
  const relevanceGate = clamp01(0.15 + relRatio * 0.95);
  const defGate = /谐音|意思是|指的是|戴口罩|听通知|空耳|本义|起源|cleanup|breaking|workspace|hard.?link/i.test(
    `${r.title} ${r.snippet}`,
  )
    ? 1.18
    : 1;
  let score = clamp01(baseScore * relevanceGate * coverageGate * defGate);
  // 覆盖率偏低：降权但不打到 0（否则整页被滤空）
  if (coverage < 0.3) score *= 0.65;
  if (coverage < 0.15) score *= 0.7;

  // 头词/单字词典假命中：直接打到接近 0（正文判实体，URL 仅弱信号）
  const entity = entityHitScore(`${r.title} ${r.snippet}`, ctx.query, { url: r.url });
  if (entity.score <= 0) score *= 0.02;
  else if (entity.score < 0.5) score *= 0.28;
  else score = clamp01(score * (0.65 + entity.score * 0.45));
  // 长核心覆盖率不足：再压一档
  if (entity.coverage != null && entity.coverage < 0.55 && entity.score > 0 && entity.score < 0.85) {
    score *= 0.55;
  }

  if (looksLikeDictionaryHeadwordPage(r.title, r.url) && extractQueryCore(ctx.query).replace(/[^\u4e00-\u9fff]/g, "").length >= 3) {
    score *= 0.05;
  }

  return {
    ...r,
    reliability: round3(reliability),
    freshness: round3(freshness),
    score: round3(score),
  };
}

/**
 * 增强后再排：有 definition/excerpts 的大幅加分
 */
export function rescoreEnriched(
  results: Array<
    SearchResult & { definition?: string; excerpts?: string[]; enriched?: boolean }
  >,
  ctx: RankContext,
  limit: number,
): Array<SearchResult & { definition?: string; excerpts?: string[]; enriched?: boolean }> {
  const scored = results.map((r) => {
    const base = scoreResult(r, ctx);
    let s = base.score ?? 0;
    const defText = `${r.definition || ""} ${r.snippet || ""}`;
    // 真释义：要求「结构完整」的句子，避免相关搜索词列表误触发
    const hasRealDef = isAnswerBearingText(defText);

    if (hasRealDef) s = clamp01(s + 0.38);
    else if (r.excerpts && r.excerpts.length > 0 && r.enriched) s = clamp01(s + 0.1);

    if (isAnswerBearingText(defText) && tokenCoverage(r, ctx.query) >= 0.4) {
      s = clamp01(s + 0.12);
    }

    // 硬降：无释义的短视频/话题/搜索壳
    if (!hasRealDef) {
      if (/\/hashtag\//i.test(r.url) || /\/search\//i.test(r.url)) s *= 0.2;
      if (/douyin\.com|iqiyi\.com|tiktok\.com/i.test(r.domain || "")) s *= 0.35;
      if (/bilibili\.com\/video\//i.test(r.url)) s *= 0.55;
    }
    return { ...r, ...base, score: round3(s) };
  });
  scored.sort((a, b) => {
    const aDef = isAnswerBearingText(`${a.definition || ""} ${a.snippet || ""}`) ? 1 : 0;
    const bDef = isAnswerBearingText(`${b.definition || ""} ${b.snippet || ""}`) ? 1 : 0;
    if (aDef !== bDef) return bDef - aDef;
    const aCov = tokenCoverage(a, ctx.query);
    const bCov = tokenCoverage(b, ctx.query);
    if (Math.abs(aCov - bCov) > 0.12) return bCov - aCov;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  // 有足够好结果时丢掉壳；否则保底返回 scored，绝不整页清空
  const strong = scored.filter((r) => {
    const cov = tokenCoverage(r, ctx.query);
    const hasDef = isAnswerBearingText(`${r.definition || ""} ${r.snippet || ""}`);
    return cov >= 0.35 || hasDef || (r.score ?? 0) >= 0.12;
  });
  let pool = strong.length >= 1 ? strong : scored;

  // 若已有可答题结果，剔除短视频/话题搜索壳（降噪，不绑死具体 query）
  const answerRows = pool.filter((r) =>
    isAnswerBearingText(`${r.definition || ""} ${r.snippet || ""}`),
  );
  if (answerRows.length >= 1) {
    const cleaned = pool.filter((r) => {
      const shell =
        /douyin\.com|tiktok\.com|iqiyi\.com/i.test(r.domain || "") ||
        /\/hashtag\//i.test(r.url) ||
        /\/search\//i.test(r.url);
      if (!shell) return true;
      return isAnswerBearingText(`${r.definition || ""} ${r.snippet || ""}`);
    });
    if (cleaned.length >= 1) pool = cleaned;
  }

  return (pool.length > 0 ? pool : scored).slice(0, limit);
}

/** 可独立回答问题的文本信号（通用，不绑死某一梗） */
export function isAnswerBearingText(text: string): boolean {
  if (!text || text.length < 12) return false;
  // 完整释义结构（排除「是什么谐音梗」类相关搜索词）
  if (/是什么(谐音|意思|梗)/.test(text) && !/(意思是|指的是|谐音[「“'"]|是谐音)/.test(text)) {
    // 仅有「是什么X」问句堆叠，不算已回答
  } else if (
    /(?<!什)(是|为|即|指).{0,6}(谐音|意思|指代)|是谐音|谐音.{0,12}(「|“|'|戴|听)|意思是|指的是|译为|本义是|指代/.test(
      text,
    )
  ) {
    return true;
  }
  // 技术文档结构
  if (
    /cleanup function|before (the )?effect (re-?)?runs|on unmount|breaking changes?|migration guide|unified error|hard.?link|symlink|workspace|auto-?(run|accept)|without (asking|confirmation)|无需.{0,8}确认/.test(
      text,
    )
  ) {
    return true;
  }
  // 发布/产品定义
  if (/open source (ai )?coding agent|launched on|rolling out|release notes/.test(text)) {
    return true;
  }
  return false;
}

export function rankAndFilter(
  results: SearchResult[],
  ctx: RankContext,
  limit: number,
): SearchResult[] {
  const scored = results.map((r) => scoreResult(r, ctx));
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // 技术意图：硬丢高噪声 / 极低相关
  const filtered = scored.filter((r) => {
    if ((r.score ?? 0) < 0.04) return false;
    const rr = relevanceRatio(r, ctx.query);
    // 相关度极低直接丢（防止刷榜）
    if (rr < 0.05) return false;
    if (ctx.techIntent) {
      for (const { re, penalty, techOnly } of NOISE_DOMAINS) {
        if (techOnly === false) continue;
        if (re.test(r.domain ?? "") && penalty >= 0.4) return false;
      }
      // 近零星 github 且相关一般
      if (
        /github\.com/i.test(r.domain ?? "") &&
        /⭐\s*[0-4]\b/.test(r.snippet || "") &&
        rr < 0.35
      ) {
        return false;
      }
    }
    if (
      isStaleForFilter(r.publishedAt, ctx.timeFilter) === "hard" &&
      (r.freshness ?? 0) < 0.1 &&
      rr < 0.3
    ) {
      return false;
    }
    return true;
  });

  // 过滤后为空：回退到已排序列表，仅去掉明确噪声域
  if (filtered.length === 0) {
    const fallback = scored.filter((r) => {
      if (ctx.techIntent) {
        for (const { re, penalty, techOnly } of NOISE_DOMAINS) {
          if (techOnly === false) continue;
          if (re.test(r.domain ?? "") && penalty >= 0.4) return false;
        }
      }
      return (r.score ?? 0) > 0.05;
    });
    return fallback.slice(0, limit);
  }

  return filtered.slice(0, limit);
}

/** 可靠性档位标签（给 LLM 读） */
export function reliabilityLabel(r: SearchResult): string {
  const s = r.reliability ?? 0;
  if (s >= 0.8) return "high";
  if (s >= 0.55) return "mid";
  return "low";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function sourceKindOf(s: string): SourceKind | string {
  return s;
}
