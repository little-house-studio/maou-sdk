/**
 * Internet Search 工具 — DuckDuckGo 搜索（无需 API Key）
 *
 * 四层降级策略：
 * 1. ddgr CLI（如果已安装且网络可达）
 * 2. DuckDuckGo Lite HTML 抓取
 * 3. DuckDuckGo Instant Answer API
 * 4. Bing HTML 抓取（国内 fallback，应对 DDG 被墙 / 代理关闭）
 */

import { execFile } from "node:child_process";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class InternetSearchTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);

  /**
   * 搜索分类 → 站点映射
   * 
   * 仅包含实测可通过 curl/API 获取搜索结果的站点。
   * 标记 [API] 的有原生搜索 API，优先使用；其余走通用搜索引擎 site: 限定。
   * 
   * 实测结果（2026-06）：
   * ✅ 可用 API：HN Algolia, Arxiv, Wikipedia, V2EX HTML, YouTube ytInitialData
   * ❌ 不可用（JS渲染/反爬/Cloudflare）：SO, MDN, 知乎, Reddit, Quora, 36kr, PH, AT, B站
   */
  private static readonly CATEGORY_SITES: Record<string, string[]> = {
    coding: [
      "github.com",                // [API] GitHub Search API — 直接调用（仓库+Issues）
      "stackoverflow.com",         // 通用搜索 site: 限定（依赖 Tavily/SearXNG）
      "developer.mozilla.org",     // 通用搜索 site: 限定
      "npmjs.com",                 // 通用搜索 site: 限定
      "pypi.org",                  // 通用搜索 site: 限定
    ],
    academic: [
      "arxiv.org",                 // [API] Arxiv API — 直接调用
      "wikipedia.org",             // [API] Wikipedia API — 直接调用
      "scholar.google.com",        // 通用搜索 site: 限定
    ],
    knowledge: [
      "news.ycombinator.com",      // [API] HN Algolia API — 直接调用
      "zhihu.com",                 // 通用搜索 site: 限定
      "reddit.com",                // 通用搜索 site: 限定
      "stackexchange.com",         // 通用搜索 site: 限定
    ],
    news: [
      "news.ycombinator.com",      // [API] HN Algolia API — 直接调用
      "techcrunch.com",            // 通用搜索 site: 限定
      "reuters.com",               // 通用搜索 site: 限定
    ],
    tools: [
      "github.com",                // [API] GitHub Search API — 直接调用
      "producthunt.com",           // 通用搜索 site: 限定
    ],
    social: [
      "reddit.com",                // 通用搜索 site: 限定
      "x.com",                     // 通用搜索 site: 限定
    ],
    video: [
      "youtube.com",               // [API] ytInitialData 解析 — 直接调用
      "bilibili.com",              // 通用搜索 site: 限定
    ],
  };

  readonly definition: ToolDefinition = {
    name: "search_internet",
    aliases: ["search"],
    description: "搜索互联网，返回实时结果。支持同时传入多个子查询并发搜索。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "主搜索词。" },
        reason: { type: "string", description: "为什么必须调用此工具而不是直接回复用户？" },
        sub_queries: {
          type: "array",
          items: { type: "string" },
          description: "附加子查询列表。复杂问题拆成多个具体子查询并发搜索，效果更好。",
        },
        time: {
          type: "string",
          enum: ["d", "w", "m", "y"],
          description: "时间范围。d=近24小时, w=近一周, m=近一月, y=近一年。",
        },
        category: {
          type: "string",
          enum: ["coding", "academic", "knowledge", "news", "tools", "social", "video", "general"],
          description: "搜索内容分类，自动限定搜索到该分类下的核心站点。不填则不限。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    timeoutMs: 30_000, // 搜索不宜太久，30秒超时
  };

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
    const query = String(params.query ?? "").trim();
    if (!query) return createToolResponse(false, "No query provided");

    const timeFilter = String(params.time ?? "").trim();
    const category = String(params.category ?? "").trim();
    const subQueries = Array.isArray(params.sub_queries)
      ? (params.sub_queries as unknown[]).map((q) => String(q).trim()).filter(Boolean).slice(0, 4)
      : [];

    const perQueryLimit = 5;
    const allResults: SearchResult[] = [];
    const seen = new Set<string>();

    // ─── 第一优先级：分类专属 API（免费、无需 Key、不依赖搜索引擎）───
    if (category && category !== "general") {
      const apiResults = await this.tryCategoryApi(query, perQueryLimit, category);
      if (apiResults && apiResults.length > 0) {
        for (const r of apiResults) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          allResults.push(r);
        }
      }
    }

    // ─── 第二优先级：通用搜索引擎（SearXNG/Tavily/ddgr/Bing）───
    // 如果有 category，为每个查询加上 site: 限定
    const sites = category && category !== "general"
      ? InternetSearchTool.CATEGORY_SITES[category] ?? []
      : [];
    const applySites = (q: string): string[] => {
      if (sites.length === 0) return [q];
      // 取前 4 个站点，每个站点一个子查询，并发搜索
      return sites.slice(0, 4).map((site) => `site:${site} ${q}`);
    };

    // 如果有 category，扩展查询；否则用原始 query + sub_queries
    const expandedQueries = sites.length > 0
      ? applySites(query)
      : [query];

    const tasks = expandedQueries
      .concat(sites.length > 0 ? [] : subQueries) // category 模式下不用 sub_queries
      .map((q) =>
        this.searchOne(q, perQueryLimit, timeFilter, category),
      );
    const settled = await Promise.all(tasks);

    let primarySource = "";
    for (const r of settled) {
      if (!r) continue;
      if (!primarySource) primarySource = r.source;
      for (const item of r.results) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        allResults.push(item);
      }
    }

    if (allResults.length === 0) {
      // 无结果视为查询成功（与 grep/glob 一致）：让 LLM 知道搜索完成但无命中，
      // 可以正常决策（换关键词、换信息源），而不是当成工具失败去 retry。
      return createToolResponse(true, "搜索无结果，建议更换搜索词或扩大时间范围后重试", {
        payload: { query, sub_queries: subQueries, count: 0 },
      });
    }

    const lines: string[] = [];
    for (let i = 0; i < allResults.length; i++) {
      const item = allResults[i];
      let domain = "";
      try {
        domain = new URL(item.url).hostname;
      } catch {
        domain = item.url;
      }
      lines.push(`${i + 1}. ${item.title}`);
      lines.push(`   ${domain} | ${item.url}`);
      if (item.snippet) {
        lines.push(`   → ${item.snippet.slice(0, 200)}`);
      }
    }

    return createToolResponse(true, `搜索结果 (${primarySource}):\n${lines.join("\n")}`, {
      payload: { results: allResults, source: primarySource },
      displayEvents: [
        { type: "terminal", stream: "info", text: `[搜索:${primarySource}] ${query}` },
      ],
    });
  }

  /**
   * 单查询搜索：SearXNG → Tavily → ddgr → DDG Lite → DDG Instant → Bing
   * - SearXNG：本地元搜索引擎（需 Docker），聚合 70+ 引擎
   * - Tavily：专为 AI Agent 设计的搜索 API，免费 1000 次/月
   */
  private searchOne(
    query: string,
    num: number,
    timeFilter: string,
    category?: string,
  ): Promise<{ results: SearchResult[]; source: string } | null> {
    return (async () => {
      const searx = await this.trySearXNG(query, num, timeFilter);
      if (searx) return { results: searx, source: "searxng" };
      const tavily = await this.tryTavily(query, num, timeFilter, category);
      if (tavily) return { results: tavily, source: "tavily" };
      const ddgr = await this.tryDdgr(query, num, timeFilter);
      if (ddgr) return { results: ddgr, source: "ddgr" };
      const lite = await this.tryDdgLite(query, num, timeFilter);
      if (lite) return { results: lite, source: "ddg-lite" };
      const instant = await this.tryDdgInstant(query, num);
      if (instant) return { results: instant, source: "ddg-instant" };
      const bing = await this.tryBing(query, num, timeFilter);
      if (bing) return { results: bing, source: "bing" };
      return null;
    })();
  }

  /**
   * 通用 curl GET（execFile 绕过 shell 解析，避免 UA 括号报错）
   */
  private curlGet(url: string, lang = "en-US,en;q=0.9", extraHeaders?: Record<string, string>): Promise<string | null> {
    return new Promise((resolve) => {
      const args = [
        "-sL", "--max-time", "12",
        "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "-H", "Accept: text/html,application/xhtml+xml,application/json",
        "-H", `Accept-Language: ${lang}`,
      ];
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          args.push("-H", `${k}: ${v}`);
        }
      }
      args.push(url);
      execFile(
        "curl", args,
        { timeout: 18_000, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error || !stdout) return resolve(null);
          resolve(stdout);
        },
      );
    });
  }

  /** ddgr CLI */
  private tryDdgr(query: string, num: number, timeFilter: string): Promise<SearchResult[] | null> {
    return new Promise((resolve) => {
      const args = ["-n", String(num), "--json", "--np"];
      if (timeFilter) args.push("-t", timeFilter);
      args.push(query);
      execFile(
        "ddgr", args,
        { timeout: 15_000, encoding: "utf-8" },
        (error, stdout) => {
          if (error || !stdout?.trim()) return resolve(null);
          try {
            const data = JSON.parse(stdout);
            if (!Array.isArray(data) || data.length === 0) return resolve(null);
            resolve(
              data.slice(0, num).map((item: Record<string, string>) => ({
                title: item.title || "",
                url: item.url || "",
                snippet: item.abstract || "",
              })),
            );
          } catch {
            resolve(null);
          }
        },
      );
    });
  }

  /** DuckDuckGo Lite HTML */
  private async tryDdgLite(query: string, num: number, timeFilter: string): Promise<SearchResult[] | null> {
    const encoded = encodeURIComponent(query);
    let url = `https://lite.duckduckgo.com/lite/?q=${encoded}`;
    if (timeFilter) url += `&df=${timeFilter}`;

    const stdout = await this.curlGet(url);
    if (!stdout) return null;
    if (stdout.includes("detected unusual traffic") || stdout.includes("captcha")) return null;

    const results: SearchResult[] = [];
    const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    let m: RegExpExecArray | null;
    const links: { url: string; title: string }[] = [];
    while ((m = linkRegex.exec(stdout)) !== null) {
      const href = m[1];
      const title = m[2].trim();
      if (href && !href.includes("duckduckgo.com") && title) {
        links.push({ url: href, title });
      }
    }

    const snippets: string[] = [];
    while ((m = snippetRegex.exec(stdout)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
    }

    for (let i = 0; i < Math.min(links.length, num); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || "",
      });
    }

    return results.length > 0 ? results : null;
  }

  /** DuckDuckGo Instant Answer API */
  private async tryDdgInstant(query: string, num: number): Promise<SearchResult[] | null> {
    const encoded = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
    const stdout = await this.curlGet(url);
    if (!stdout) return null;

    try {
      const data = JSON.parse(stdout);
      const results: SearchResult[] = [];

      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: data.Heading || query,
          url: data.AbstractURL,
          snippet: data.AbstractText,
        });
      }

      const topics = data.RelatedTopics || [];
      for (const topic of topics) {
        if (results.length >= num) break;
        if (topic.FirstURL && topic.Text) {
          results.push({
            title: topic.Text.slice(0, 80),
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }

      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }

  /** Bing HTML 抓取（国内 fallback） */
  private async tryBing(query: string, num: number, timeFilter: string): Promise<SearchResult[] | null> {
    const encoded = encodeURIComponent(query);
    let url = `https://www.bing.com/search?q=${encoded}&count=${num}`;
    if (timeFilter) {
      const filterMap: Record<string, string> = { d: "ez5_d-1", w: "ez5_w-1", m: "ez5_m-1", y: "ez5_y-1" };
      const f = filterMap[timeFilter];
      if (f) url += `&filters=${f}`;
    }

    const stdout = await this.curlGet(url, "zh-CN,zh;q=0.9,en;q=0.8");
    if (!stdout || stdout.length < 1000) return null;

    const results: SearchResult[] = [];
    const algoRegex = /<li class="b_algo"[^>]*>/g;
    const positions: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = algoRegex.exec(stdout)) !== null) {
      positions.push(m.index);
    }

    for (let i = 0; i < Math.min(positions.length, num); i++) {
      const start = positions[i];
      const end = i + 1 < positions.length ? positions[i + 1] : stdout.indexOf("</li>", start) + 5;
      const chunk = stdout.slice(start, end > start ? end : start + 3000);

      const h2Match = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!h2Match) continue;

      const u = h2Match[1];
      const title = h2Match[2].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
      if (!title || title.length < 2) continue;

      const citeMatch = chunk.match(/<cite[^>]*>([\s\S]*?)<\/cite>/);
      const citeText = citeMatch
        ? citeMatch[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim()
        : "";

      const pMatch = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/) || chunk.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
      const snippet = pMatch
        ? pMatch[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim()
        : "";

      results.push({ title, url: citeText || u, snippet });
    }

    return results.length > 0 ? results : null;
  }

  /**
   * 分类专属 API 搜索：根据 category 直接调用有原生 API 的站点
   * 不依赖任何通用搜索引擎，不消耗 API 额度
   */
  private async tryCategoryApi(
    query: string,
    num: number,
    category: string,
  ): Promise<SearchResult[] | null> {
    switch (category) {
      case "coding":
        return (await this.tryGitHubApi(query, num, "repositories"))
            ?? (await this.tryGitHubApi(query, num, "issues"));
      case "tools":
        return (await this.tryGitHubApi(query, num, "repositories"))
            ?? (await this.tryGitHubApi(query, num, "issues"));
      case "academic":
        return (await this.tryArxivApi(query, num)) ?? (await this.tryWikipediaApi(query, num));
      case "knowledge":
      case "news":
        return await this.tryHnAlgoliaApi(query, num);
      case "video":
        return await this.tryYoutubeSearch(query, num);
      default:
        return null;
    }
  }

  /** GitHub Search API — 免费，无需 Key，10次/分钟限流，返回 JSON */
  private async tryGitHubApi(
    query: string,
    num: number,
    type: "repositories" | "issues",
  ): Promise<SearchResult[] | null> {
    try {
      const encoded = encodeURIComponent(query);
      let url: string;
      if (type === "repositories") {
        url = `https://api.github.com/search/repositories?q=${encoded}&sort=stars&per_page=${Math.min(num, 10)}`;
      } else {
        url = `https://api.github.com/search/issues?q=${encodeURIComponent(query + " is:issue is:open")}&sort=comments&per_page=${Math.min(num, 10)}`;
      }
      const stdout = await this.curlGet(url, "en-US,en;q=0.9", {
        Accept: "application/vnd.github.v3+json",
      });
      if (!stdout) return null;

      const data = JSON.parse(stdout);
      const items = data.items ?? [];
      if (items.length === 0) return null;

      return items.map((item: Record<string, unknown>) => {
        if (type === "repositories") {
          return {
            title: String(item.full_name || ""),
            url: String(item.html_url || ""),
            snippet: `⭐${item.stargazers_count || 0} | ${String(item.description || "").slice(0, 150)}`,
          };
        } else {
          return {
            title: String(item.title || ""),
            url: String(item.html_url || ""),
            snippet: `💬${item.comments || 0} | ${String(item.body || "").slice(0, 150).replace(/\r?\n/g, " ")}`,
          };
        }
      });
    } catch {
      return null;
    }
  }

  /** Arxiv API — 免费，无需 Key，返回 XML/Atom */
  private async tryArxivApi(query: string, num: number): Promise<SearchResult[] | null> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `http://export.arxiv.org/api/query?search_query=all:${encoded}&max_results=${Math.min(num, 10)}&sortBy=relevance&sortOrder=descending`;
      const stdout = await this.curlGet(url, "en-US,en;q=0.9");
      if (!stdout || !stdout.includes("<entry>")) return null;

      const results: SearchResult[] = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let m: RegExpExecArray | null;
      while ((m = entryRegex.exec(stdout)) !== null && results.length < num) {
        const chunk = m[1];
        const titleMatch = chunk.match(/<title>([\s\S]*?)<\/title>/);
        const idMatch = chunk.match(/<id>([\s\S]*?)<\/id>/);
        const summaryMatch = chunk.match(/<summary>([\s\S]*?)<\/summary>/);
        if (titleMatch && idMatch) {
          results.push({
            title: titleMatch[1].replace(/\n/g, " ").trim(),
            url: idMatch[1].trim().replace("http://", "https://"),
            snippet: summaryMatch ? summaryMatch[1].replace(/\n/g, " ").trim().slice(0, 200) : "",
          });
        }
      }
      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }

  /** Wikipedia API — 免费，无需 Key，返回 JSON */
  private async tryWikipediaApi(query: string, num: number): Promise<SearchResult[] | null> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&srlimit=${Math.min(num, 10)}`;
      const stdout = await this.curlGet(url, "en-US,en;q=0.9");
      if (!stdout) return null;

      const data = JSON.parse(stdout);
      const items = data.query?.search ?? [];
      if (items.length === 0) return null;

      return items.map((item: Record<string, unknown>) => ({
        title: String(item.title || ""),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || "")).replace(/%20/g, "_")}`,
        snippet: String(item.snippet || "").replace(/<[^>]+>/g, "").slice(0, 200),
      }));
    } catch {
      return null;
    }
  }

  /** HN Algolia API — 免费，无需 Key，返回 JSON */
  private async tryHnAlgoliaApi(query: string, num: number): Promise<SearchResult[] | null> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://hn.algolia.com/api/v1/search?query=${encoded}&tags=story&hitsPerPage=${Math.min(num, 20)}`;
      const stdout = await this.curlGet(url, "en-US,en;q=0.9");
      if (!stdout) return null;

      const data = JSON.parse(stdout);
      const items = data.hits ?? [];
      if (items.length === 0) return null;

      return items.map((item: Record<string, unknown>) => ({
        title: String(item.title || ""),
        url: String(item.url || `https://news.ycombinator.com/item?id=${item.objectID || ""}`),
        snippet: `points: ${item.points || 0} | comments: ${item.num_comments || 0}`,
      }));
    } catch {
      return null;
    }
  }

  /** YouTube 搜索 — 解析 ytInitialData JSON */
  private async tryYoutubeSearch(query: string, num: number): Promise<SearchResult[] | null> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://www.youtube.com/results?search_query=${encoded}`;
      const stdout = await this.curlGet(url, "en-US,en;q=0.9");
      if (!stdout) return null;

      // 提取 ytInitialData JSON
      const match = stdout.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});/);
      if (!match) return null;

      const data = JSON.parse(match[1]);
      // 导航到搜索结果
      const contents = data?.contents?.twoColumnSearchResultsRenderer
        ?.primaryContents?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents ?? [];

      const results: SearchResult[] = [];
      for (const item of contents) {
        if (results.length >= num) break;
        const video = item.videoRenderer;
        if (!video) continue;
        results.push({
          title: video.title?.runs?.[0]?.text || "",
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          snippet: `${video.ownerText?.runs?.[0]?.text || ""} | ${video.lengthText?.simpleText || ""} | ${video.viewCountText?.simpleText || ""}`,
        });
      }
      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }

  /**
   * Tavily Search API — 专为 AI Agent 设计的搜索，免费 1000 次/月
   * 支持 include_domains/exclude_domains、topic=news、时间范围
   * API Key 从环境变量 TAVILY_API_KEY 读取
   */
  private async tryTavily(
    query: string,
    num: number,
    timeFilter: string,
    category?: string,
  ): Promise<SearchResult[] | null> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return null; // 未配置则跳过

    // category → include_domains 映射
    const categoryDomains = category && category !== "general"
      ? InternetSearchTool.CATEGORY_SITES[category] ?? []
      : [];

    // Tavily time_range 参数映射
    const timeMap: Record<string, string> = { d: "day", w: "week", m: "month", y: "year" };
    const timeRange = timeMap[timeFilter] || undefined;

    // 判断是否为新闻类查询
    const topic = category === "news" ? "news" : "general";

    try {
      const body: Record<string, unknown> = {
        query,
        max_results: num,
        search_depth: "basic",
        topic,
      };
      if (categoryDomains.length > 0) {
        body.include_domains = categoryDomains;
      }
      if (timeRange) {
        body.time_range = timeRange;
      }

      const resp = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) return null;

      const data = await resp.json() as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      const rawResults = data.results ?? [];
      if (rawResults.length === 0) return null;

      return rawResults.map((item) => ({
        title: item.title || "",
        url: item.url || "",
        snippet: (item.content || "").slice(0, 200),
      }));
    } catch {
      return null;
    }
  }

  /**
   * SearXNG 元搜索引擎 — 一次搜索聚合 Google/Bing/DDG/GitHub/SO/知乎 等 70+ 源
   * 优先使用本地实例（localhost:8888），回退到公共实例列表
   */
  private async trySearXNG(
    query: string,
    num: number,
    timeFilter: string,
  ): Promise<SearchResult[] | null> {
    const instances = [
      "http://localhost:8888",    // 本地自托管实例（优先）
      "http://localhost:8080",    // Docker 默认端口
      "https://search.sapti.me",  // 公共实例（欧洲）
      "https://searx.be",         // 公共实例
      "https://search.bus-hit.me", // 公共实例
    ];

    // SearXNG time_filter 参数映射
    const tfMap: Record<string, string> = { d: "day", w: "week", m: "month", y: "year" };
    const tf = tfMap[timeFilter] || "";

    for (const base of instances) {
      try {
        const encoded = encodeURIComponent(query);
        let url = `${base}/search?q=${encoded}&format=json&pageno=1`;
        if (tf) url += `&time_range=${tf}`;

        const stdout = await this.curlGet(url, "zh-CN,zh;q=0.9,en;q=0.8");
        if (!stdout) continue;

        const data = JSON.parse(stdout);
        const rawResults = data.results || [];
        if (rawResults.length === 0) continue;

        const results: SearchResult[] = [];
        for (const item of rawResults) {
          if (results.length >= num) break;
          if (!item.url || !item.title) continue;
          // SearXNG 可能返回同一 URL 多次（来自不同引擎），去重
          const normalizedUrl = item.url.replace(/&amp;/g, "&");
          if (results.some((r) => r.url === normalizedUrl)) continue;
          results.push({
            title: item.title,
            url: normalizedUrl,
            snippet: (item.content || "").slice(0, 200),
          });
        }

        if (results.length > 0) return results;
      } catch {
        // 该实例不可用，继续尝试下一个
        continue;
      }
    }

    return null;
  }
}
