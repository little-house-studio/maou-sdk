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
import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class InternetSearchTool extends Tool {
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
      },
      required: ["query"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
    const query = String(params.query ?? "").trim();
    if (!query) return createToolResponse(false, "No query provided");

    const timeFilter = String(params.time ?? "").trim();
    const subQueries = Array.isArray(params.sub_queries)
      ? (params.sub_queries as unknown[]).map((q) => String(q).trim()).filter(Boolean).slice(0, 4)
      : [];

    const perQueryLimit = 5;
    const allResults: SearchResult[] = [];
    const seen = new Set<string>();

    const tasks = [query, ...subQueries].map((q) =>
      this.searchOne(q, perQueryLimit, timeFilter),
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
      return createToolResponse(false, "搜索无结果，建议更换搜索词后重试");
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
   * 单查询降级链：ddgr → DDG Lite → DDG Instant → Bing
   */
  private searchOne(
    query: string,
    num: number,
    timeFilter: string,
  ): Promise<{ results: SearchResult[]; source: string } | null> {
    return (async () => {
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
  private curlGet(url: string, lang = "en-US,en;q=0.9"): Promise<string | null> {
    return new Promise((resolve) => {
      const args = [
        "-sL", "--max-time", "12",
        "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "-H", "Accept: text/html,application/xhtml+xml,application/json",
        "-H", `Accept-Language: ${lang}`,
        url,
      ];
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
}
