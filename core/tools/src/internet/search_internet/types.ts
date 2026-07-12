/**
 * search_internet 内部类型
 */

export type SearchCategory =
  | "coding"
  | "academic"
  | "knowledge"
  | "news"
  | "tools"
  | "social"
  | "video"
  | "general";

export type TimeFilter = "d" | "w" | "m" | "y" | "";

/** 后端来源（全部免费） */
export type SourceKind =
  | "github-api"
  | "npm-api"
  | "mdn-api"
  | "stackexchange-api"
  | "crates-api"
  | "pkggo-api"
  | "dockerhub-api"
  | "devto-api"
  | "arxiv-api"
  | "wikipedia-api"
  | "hn-api"
  | "google-news-rss"
  | "youtube"
  | "ddgr"
  | "ddg-lite"
  | "ddg-html"
  | "ddg-instant"
  | "bing"
  | "baidu"
  | "so360"
  | "docs-site";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** 后端标识 */
  source: SourceKind | string;
  /** 解析到的发布时间（ISO 或 YYYY-MM-DD），未知则 undefined */
  publishedAt?: string;
  /** 0..1 可靠性分（排序用，执行后写入） */
  reliability?: number;
  /** 0..1 时效分（排序用） */
  freshness?: number;
  /** 综合分 */
  score?: number;
  /** 域名（规范化后） */
  domain?: string;
}

export interface RankContext {
  query: string;
  category: SearchCategory | "";
  timeFilter: TimeFilter;
  /** 编程/技术意图时提高 docs/github 权重 */
  techIntent: boolean;
}
