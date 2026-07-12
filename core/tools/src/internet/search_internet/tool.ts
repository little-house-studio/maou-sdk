/**
 * Internet Search — 可靠优先的实时搜索（全免费）
 *
 * 管线（对齐「合格搜索工具」标准）：
 *   1. 分类垂直 API（可选）
 *   2. 多源 SERP：中文 baidu+cn.bing 合并；英文短路链；仅 empty 降级
 *   3. 粗排 → 抓取 topK 正文 enrich（释义句 / L 行摘录）
 *   4. 释义向重排 → 输出 title/url/Content/L1.. 结构
 *
 * 可选：GITHUB_TOKEN — 提高 GitHub 限流；ddgr CLI 增强（非 npm）
 */

import { Tool, toolDir, createToolResponse } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import {
  expandExplainQueries,
  formatEngineNotices,
  searchCategoryApis,
  searchFreeEngines,
} from "./backends.js";
import { enrichTop } from "./enrich.js";
import { resultKey } from "./normalize.js";
import {
  extractQueryCore,
  filterHeadTokenFalseHits,
  softRecoverEntityHits,
} from "./query_core.js";
import {
  detectTechIntent,
  rankAndFilter,
  reliabilityLabel,
  rescoreEnriched,
} from "./rank.js";
import type { SearchCategory, SearchResult, TimeFilter } from "./types.js";

const CATEGORY_SITES: Record<string, string[]> = {
  coding: [
    "github.com",
    "stackoverflow.com",
    "developer.mozilla.org",
    "npmjs.com",
    "crates.io",
    "pkg.go.dev",
    "pypi.org",
  ],
  academic: ["arxiv.org", "wikipedia.org", "scholar.google.com"],
  knowledge: [
    "news.ycombinator.com",
    "stackoverflow.com",
    "reddit.com",
    "zhihu.com",
  ],
  news: ["news.ycombinator.com", "news.google.com", "techcrunch.com", "reuters.com"],
  tools: ["github.com", "hub.docker.com", "dev.to", "producthunt.com"],
  social: ["reddit.com", "x.com"],
  video: ["youtube.com", "bilibili.com"],
};

export class InternetSearchTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);

  readonly definition: ToolDefinition = {
    name: "search_internet",
    aliases: ["search"],
    description:
      "搜索互联网，返回按可靠性与时效排序的实时结果。支持多子查询并发、时间过滤、分类垂直源。关键事实请再用 reader/浏览器打开链接核实。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "主搜索词。宜短、具体；技术问题加版本/项目名。",
        },
        reason: {
          type: "string",
          description: "为何需要联网（可选，便于审计）。",
        },
        sub_queries: {
          type: "array",
          items: { type: "string" },
          description:
            "附加子查询（最多 4 个）。复杂问题拆成多角度并发搜索，效果更好。",
        },
        time: {
          type: "string",
          enum: ["d", "w", "m", "y"],
          description:
            "时效窗口：d=24h, w=一周, m=一月, y=一年。要最新动态务必设置 d 或 w。",
        },
        category: {
          type: "string",
          enum: [
            "coding",
            "academic",
            "knowledge",
            "news",
            "tools",
            "social",
            "video",
            "general",
          ],
          description:
            "垂直分类：coding/tools 会合并 GitHub·npm·SO 等 API；news 偏资讯；不填=general。",
        },
        max_results: {
          type: "number",
          description: "返回条数上限，默认 10，最大 15。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    timeoutMs: 75_000,
  };

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
    const query = String(params.query ?? "").trim();
    if (!query) return createToolResponse(false, "No query provided");

    const timeFilter = (String(params.time ?? "").trim() || "") as TimeFilter;
    const categoryRaw = String(params.category ?? "general").trim() || "general";
    const category = (
      [
        "coding",
        "academic",
        "knowledge",
        "news",
        "tools",
        "social",
        "video",
        "general",
      ].includes(categoryRaw)
        ? categoryRaw
        : "general"
    ) as SearchCategory;

    const subQueries = Array.isArray(params.sub_queries)
      ? (params.sub_queries as unknown[])
          .map((q) => String(q).trim())
          .filter(Boolean)
          .slice(0, 4)
      : [];

    const maxResults = Math.min(
      15,
      Math.max(3, Number(params.max_results) > 0 ? Number(params.max_results) : 10),
    );
    const perQueryLimit = Math.min(8, maxResults);

    const sourcesUsed = new Set<string>();
    const bucket: SearchResult[] = [];
    const seen = new Set<string>();

    const pushAll = (items: SearchResult[], sourceLabel?: string) => {
      for (const item of items) {
        const key = resultKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        bucket.push(item);
        if (sourceLabel) sourcesUsed.add(sourceLabel);
        else if (item.source) sourcesUsed.add(String(item.source));
      }
    };

    // ── 1) 分类原生 API 并行合并（免费公开接口）──────────────
    // general 时若 query 像技术文档问题，自动叠加 coding 垂直源（不写死答案，只多一路免费召回）
    const autoCoding =
      category === "general" &&
      /\b(useEffect|useState|useMemo|react|typescript|javascript|npm|pnpm|yarn|zod|node\.?js|webpack|vite|eslint|cleanup|hook|api|sdk|opencode)\b/i.test(
        query,
      );
    const autoNews =
      category === "general" &&
      /\b(news|release date|launched|announces|今日|新闻|发布)\b/i.test(query);
    const cats = new Set<string>();
    if (category !== "general") cats.add(category);
    if (autoCoding) cats.add("coding");
    if (autoNews) cats.add("news");
    for (const c of cats) {
      const catResults = await searchCategoryApis(query, perQueryLimit, c);
      pushAll(catResults);
    }

    // ── 2) 通用引擎：主 query + 用户 sub + 自动释义扩展 + site: ─
    const engineQueries: string[] = [query];
    for (const sq of subQueries) {
      if (sq !== query) engineQueries.push(sq);
    }
    for (const eq of expandExplainQueries(query)) {
      if (!engineQueries.includes(eq)) engineQueries.push(eq);
    }

    const sites = category !== "general" ? CATEGORY_SITES[category] ?? [] : [];
    if (sites.length > 0) {
      for (const site of sites.slice(0, 2)) {
        engineQueries.push(`site:${site} ${query}`);
      }
    }

    const uniqueQueries = [...new Set(engineQueries.map((q) => q.trim()).filter(Boolean))].slice(
      0,
      5,
    );

    const engineSettled = await Promise.all(
      uniqueQueries.map((q) => searchFreeEngines(q, perQueryLimit, timeFilter)),
    );

    const engineTrails: Array<
      Array<{ source: string; status: string; reason?: string }> | undefined
    > = [];
    let droppedHead = 0;
    for (const r of engineSettled) {
      if (r?.trail) engineTrails.push(r.trail);
      if (!r) continue;
      // 硬过滤头词假命中（绝不用词典单字页冒充「巧乐兹火车头」）
      const { kept, dropped } = filterHeadTokenFalseHits(r.results, query);
      droppedHead += dropped;
      if (kept.length > 0) pushAll(kept, r.source);
    }
    // 严格过滤后仍为空：软回收（仍禁止 partial-head 与词典单字页，绝不回灌污染）
    if (bucket.length === 0) {
      for (const r of engineSettled) {
        if (!r?.results?.length) continue;
        const recovered = softRecoverEntityHits(r.results, query);
        if (recovered.length > 0) pushAll(recovered, r.source);
      }
    }
    if (droppedHead > 0) {
      engineTrails.push([
        {
          source: "head-token-filter",
          status: "empty",
          reason: `丢弃 ${droppedHead} 条仅命中头词/单字词典的假结果`,
        },
      ]);
    }

    const engineNotices = formatEngineNotices(
      engineTrails as Parameters<typeof formatEngineNotices>[0],
    );

    if (bucket.length === 0) {
      return createToolResponse(
        true,
        [
          "搜索无结果。",
          ...engineNotices,
          "建议：更换关键词、放宽 time、改 category=general，或按上方提示安装/修复搜索引擎后重试。",
        ]
          .filter(Boolean)
          .join("\n"),
        {
          payload: {
            query,
            sub_queries: subQueries,
            time: timeFilter || null,
            category,
            count: 0,
            sources: [],
            engine_trails: engineTrails,
            engine_notices: engineNotices,
          },
        },
      );
    }

    // ── 3) 粗排 → 正文 enrich → 释义重排 ─────────────────────
    const techIntent = detectTechIntent(
      [query, ...subQueries].join(" "),
      category,
    );
    const rankCtx = {
      query: [query, ...subQueries].join(" "),
      category,
      timeFilter,
      techIntent,
    };

    // 粗排多取一些，留给 enrich；若过滤过严导致空，回退到未过滤 bucket 前 N
    let coarse = rankAndFilter(bucket, rankCtx, Math.min(16, maxResults * 2));
    if (coarse.length === 0 && bucket.length > 0) {
      coarse = bucket.slice(0, Math.min(12, bucket.length));
    }
    const enriched = await enrichTop(coarse, query, Math.min(8, Math.max(coarse.length, 1)));
    let ranked = rescoreEnriched(enriched, rankCtx, maxResults);
    if (ranked.length === 0 && enriched.length > 0) {
      ranked = enriched.slice(0, maxResults);
    }
    if (ranked.length === 0 && bucket.length > 0) {
      ranked = bucket.slice(0, maxResults).map((r) => ({ ...r, enriched: false, excerpts: r.snippet ? [r.snippet] : [] }));
    }

    if (ranked.length === 0) {
      return createToolResponse(
        true,
        [
          "搜索无可用结果（引擎返回空或全部被过滤）。",
          ...engineNotices,
          "建议：更换关键词、放宽 time，或检查网络/curl。",
        ].join("\n"),
        {
          payload: {
            query,
            sub_queries: subQueries,
            time: timeFilter || null,
            category,
            count: 0,
            sources: [...sourcesUsed],
            raw_count: bucket.length,
            engine_trails: engineTrails,
            engine_notices: engineNotices,
          },
        },
      );
    }

    const sourceList = [...sourcesUsed].sort();
    const defHits = ranked.filter((r) => r.definition).length;
    const header = [
      `搜索结果 ${ranked.length} 条`,
      `源=[${sourceList.join(",") || "mixed"}]`,
      timeFilter ? `时效=${timeFilter}` : "时效=不限",
      techIntent ? "意图=tech" : "意图=general",
      `正文增强=${defHits}/${ranked.length}`,
    ].join(" · ");

    // 输出对齐合格工具：标题 / URL / Content / L 行摘录
    const lines: string[] = [header, ""];
    for (let i = 0; i < ranked.length; i++) {
      const item = ranked[i];
      const rel = reliabilityLabel(item);
      lines.push(`[${i + 1}] [${rel}] ${item.title}`);
      lines.push(`${item.url}`);
      const content = item.definition || item.snippet || "";
      if (content) lines.push(`Content: ${content.slice(0, 280)}`);
      const excerpts = item.excerpts?.length
        ? item.excerpts
        : item.snippet
          ? [item.snippet]
          : [];
      excerpts.slice(0, 4).forEach((ex, j) => {
        lines.push(`L${j + 1}: ${ex.slice(0, 220)}`);
      });
      lines.push(
        `meta: domain=${item.domain || "?"} source=${item.source} score=${item.score?.toFixed(2) ?? "?"} enriched=${item.enriched ? "yes" : "no"}${item.publishedAt ? ` date=${item.publishedAt}` : ""}`,
      );
      lines.push("");
    }

    if (engineNotices.length > 0) {
      lines.push("── 引擎状态（请转告用户或自行安装后重试）──");
      lines.push(...engineNotices);
      lines.push("");
    }

    lines.push(
      "提示：优先采信带 Content/L 行且含「谐音/意思是/指的是」等释义句的结果；短视频话题页仅作旁证。",
    );

    return createToolResponse(true, lines.join("\n"), {
      payload: {
        query,
        sub_queries: subQueries,
        time: timeFilter || null,
        category,
        count: ranked.length,
        sources: sourceList,
        tech_intent: techIntent,
        engine_trails: engineTrails,
        engine_notices: engineNotices,
        results: ranked.map((r) => ({
          title: r.title,
          url: r.url,
          domain: r.domain,
          snippet: r.snippet,
          definition: r.definition ?? null,
          excerpts: r.excerpts ?? [],
          enriched: !!r.enriched,
          source: r.source,
          published_at: r.publishedAt ?? null,
          reliability: r.reliability,
          freshness: r.freshness,
          score: r.score,
          reliability_label: reliabilityLabel(r),
        })),
      },
      displayEvents: [
        {
          type: "terminal",
          stream: "info",
          text: `[搜索:${sourceList.slice(0, 3).join("+")}${sourceList.length > 3 ? "+…" : ""}] ${query}${timeFilter ? ` (${timeFilter})` : ""}`,
        },
      ],
    });
  }
}
