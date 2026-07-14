/**
 * 搜索后端（全部免费）：
 *   分类原生 API（GitHub/npm/HN/…）→ 通用引擎（仅「搜到 0 条」才降级）
 *
 * 降级语义（重要）：
 *   - ok：拿到结果 → 停止，不再降级
 *   - empty：引擎可用且查询成功，但 0 条 → 才允许试下一引擎
 *   - unavailable：二进制未装 / 网络失败 / captcha → 跳过，不算「搜不到」
 *
 * 不把「没装 ddgr」当成搜不到。ddgr 为可选外部 CLI（非 npm 依赖），
 * 未安装时直接 skip，主路径是 HTTP 引擎（curl）。
 */

import { execFile, execFileSync } from "node:child_process";
import { normalizeDateString, normalizeResult, stripHtml } from "./normalize.js";
import {
  extractQueryCore,
  filterHeadTokenFalseHits,
  isHeadTokenCollapsed,
  phraseQueryVariants,
  softRecoverEntityHits,
} from "./query_core.js";
import type { SearchResult, TimeFilter } from "./types.js";

/** 单引擎运行结果：区分「不可用」与「搜空」 */
export type EngineStatus = "ok" | "empty" | "unavailable";

export interface EngineOutcome {
  status: EngineStatus;
  source: string;
  results?: SearchResult[];
  /** unavailable / empty 时的原因，便于诊断 */
  reason?: string;
}

// ── HTTP ─────────────────────────────────────────────────────

export function curlGet(
  url: string,
  opts?: {
    lang?: string;
    headers?: Record<string, string>;
    timeoutSec?: number;
  },
): Promise<string | null> {
  const lang = opts?.lang ?? "en-US,en;q=0.9";
  const timeoutSec = opts?.timeoutSec ?? 12;
  return new Promise((resolve) => {
    const args = [
      "-sL",
      "--max-time",
      String(timeoutSec),
      "-H",
      "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "-H",
      "Accept: text/html,application/xhtml+xml,application/json,*/*;q=0.8",
      "-H",
      `Accept-Language: ${lang}`,
    ];
    if (opts?.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        args.push("-H", `${k}: ${v}`);
      }
    }
    args.push(url);
    execFile(
      "curl",
      args,
      { timeout: (timeoutSec + 6) * 1000, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout) return resolve(null);
        resolve(stdout);
      },
    );
  });
}

function mapNormalized(
  items: Array<Partial<SearchResult> & { title?: string; url?: string; snippet?: string }>,
  source: string,
): SearchResult[] {
  const out: SearchResult[] = [];
  for (const it of items) {
    const n = normalizeResult(it, source);
    if (n) out.push(n);
  }
  return out;
}

// ── 免费通用引擎 ─────────────────────────────────────────────

let ddgrAvailable: boolean | null = null;

/** ddgr 是外部 CLI，不是 npm 依赖；未安装 → unavailable，绝不假装「搜空」 */
function isDdgrAvailable(): boolean {
  if (ddgrAvailable != null) return ddgrAvailable;
  try {
    execFileSync("which", ["ddgr"], { stdio: "pipe", timeout: 2000 });
    ddgrAvailable = true;
  } catch {
    ddgrAvailable = false;
  }
  return ddgrAvailable;
}

export function tryDdgr(
  query: string,
  num: number,
  timeFilter: TimeFilter,
): Promise<EngineOutcome> {
  if (!isDdgrAvailable()) {
    return Promise.resolve({
      status: "unavailable",
      source: "ddgr",
      reason: "ddgr CLI 未安装（可选增强，非 npm 包；建议 brew install ddgr 或 pip install ddgr）",
    });
  }
  return new Promise((resolve) => {
    const args = ["-n", String(num), "--json", "--np"];
    if (timeFilter) args.push("-t", timeFilter);
    args.push(query);
    execFile("ddgr", args, { timeout: 15_000, encoding: "utf-8" }, (error, stdout) => {
      if (error) {
        const msg = String((error as NodeJS.ErrnoException).message || error);
        // 执行失败 = 引擎不可用，不是「搜到 0 条」
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          ddgrAvailable = false;
          return resolve({
            status: "unavailable",
            source: "ddgr",
            reason: "ddgr 可执行文件不存在",
          });
        }
        return resolve({
          status: "unavailable",
          source: "ddgr",
          reason: `ddgr 执行失败: ${msg.slice(0, 120)}`,
        });
      }
      if (!stdout?.trim()) {
        return resolve({ status: "empty", source: "ddgr", reason: "ddgr 返回空输出" });
      }
      try {
        const data = JSON.parse(stdout);
        if (!Array.isArray(data) || data.length === 0) {
          return resolve({ status: "empty", source: "ddgr", reason: "ddgr 结果为 []" });
        }
        const results = mapNormalized(
          data.slice(0, num).map((item: Record<string, string>) => ({
            title: item.title || "",
            url: item.url || "",
            snippet: item.abstract || "",
          })),
          "ddgr",
        );
        if (results.length === 0) {
          return resolve({
            status: "empty",
            source: "ddgr",
            reason: "ddgr 原始结果均被 URL 归一化丢弃",
          });
        }
        resolve({ status: "ok", source: "ddgr", results });
      } catch {
        resolve({
          status: "unavailable",
          source: "ddgr",
          reason: "ddgr JSON 解析失败",
        });
      }
    });
  });
}

export async function tryDdgLite(
  query: string,
  num: number,
  timeFilter: TimeFilter,
): Promise<EngineOutcome> {
  const encoded = encodeURIComponent(query);
  let url = `https://lite.duckduckgo.com/lite/?q=${encoded}`;
  if (timeFilter) url += `&df=${timeFilter}`;

  const stdout = await curlGet(url);
  if (!stdout) {
    return {
      status: "unavailable",
      source: "ddg-lite",
      reason: "HTTP 无响应（网络/curl 失败）",
    };
  }
  if (stdout.includes("detected unusual traffic") || stdout.includes("captcha")) {
    return {
      status: "unavailable",
      source: "ddg-lite",
      reason: "被 DDG 风控/captcha 拦截",
    };
  }

  const links: { url: string; title: string }[] = [];
  const linkRegex = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(stdout)) !== null) {
    const href = m[1];
    const title = m[2].trim();
    if (href && !href.includes("duckduckgo.com") && title) {
      links.push({ url: href, title });
    }
  }

  const snippets: string[] = [];
  const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  while ((m = snippetRegex.exec(stdout)) !== null) {
    snippets.push(stripHtml(m[1]));
  }

  const raw = links.slice(0, num).map((l, i) => ({
    title: l.title,
    url: l.url,
    snippet: snippets[i] || "",
  }));
  const results = mapNormalized(raw, "ddg-lite");
  if (results.length === 0) {
    return {
      status: "empty",
      source: "ddg-lite",
      reason: links.length === 0 ? "页面无结果链接" : "结果均被归一化丢弃",
    };
  }
  return { status: "ok", source: "ddg-lite", results };
}

export async function tryDdgInstant(
  query: string,
  num: number,
): Promise<EngineOutcome> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
  const stdout = await curlGet(url);
  if (!stdout) {
    return {
      status: "unavailable",
      source: "ddg-instant",
      reason: "HTTP 无响应",
    };
  }

  try {
    const data = JSON.parse(stdout);
    const items: Array<{ title: string; url: string; snippet: string }> = [];

    if (data.AbstractText && data.AbstractURL) {
      items.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    const topics = data.RelatedTopics || [];
    for (const topic of topics) {
      if (items.length >= num) break;
      if (topic.FirstURL && topic.Text) {
        items.push({
          title: String(topic.Text).slice(0, 80),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      } else if (Array.isArray(topic.Topics)) {
        for (const sub of topic.Topics) {
          if (items.length >= num) break;
          if (sub.FirstURL && sub.Text) {
            items.push({
              title: String(sub.Text).slice(0, 80),
              url: sub.FirstURL,
              snippet: sub.Text,
            });
          }
        }
      }
    }

    const results = mapNormalized(items, "ddg-instant");
    if (results.length === 0) {
      return { status: "empty", source: "ddg-instant", reason: "Instant Answer 无条目" };
    }
    return { status: "ok", source: "ddg-instant", results };
  } catch {
    return {
      status: "unavailable",
      source: "ddg-instant",
      reason: "JSON 解析失败",
    };
  }
}

/**
 * 是否含中日韩等表意文字 → 走 cn.bing / baidu（www.bing 对中文梗会拆词成「大」）
 */
export function hasCjk(s: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(s);
}

/**
 * 百度网页搜索（中文主源之一）
 * 解析 h3 > a 结果；跳转 url 可能是 baidu.com/link?url=
 */
export async function tryBaidu(
  query: string,
  num: number,
  _timeFilter: TimeFilter,
): Promise<EngineOutcome> {
  const encoded = encodeURIComponent(query);
  // rn=条数；ie/oe=utf-8
  const url = `https://www.baidu.com/s?wd=${encoded}&rn=${Math.min(num + 4, 20)}&ie=utf-8`;
  const stdout = await curlGet(url, { lang: "zh-CN,zh;q=0.9" });
  if (!stdout) {
    return { status: "unavailable", source: "baidu", reason: "HTTP 无响应" };
  }
  if (stdout.length < 800) {
    return {
      status: "unavailable",
      source: "baidu",
      reason: `响应过短 (${stdout.length}B)`,
    };
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // 多种百度结果模板（桌面/移动/新版 class）
  const patterns = [
    /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi,
    /<a[^>]+data-click[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<div class="c-container"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const h3Re of patterns) {
    h3Re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = h3Re.exec(stdout)) !== null && results.length < num) {
      let href = m[1];
      const title = stripHtml(m[2]);
      if (!title || title.length < 2) continue;
      if (/百度|登录|更多|展开/.test(title) && title.length < 6) continue;

      const after = stdout.slice(m.index, m.index + 2500);
      const abs =
        after.match(/class="c-abstract"[^>]*>([\s\S]*?)<\/(?:span|div|td)/i) ||
        after.match(/class="content-right_[^"]*"[^>]*>([\s\S]*?)<\/span/i) ||
        after.match(/<span class="c-color-text"[^>]*>([\s\S]*?)<\/span>/i) ||
        after.match(/class="c-span-last"[^>]*>([\s\S]*?)<\/span/i);
      const snippet = abs ? stripHtml(abs[1]) : "";

      if (href.startsWith("//")) href = "https:" + href;
      if (href.startsWith("/")) href = "https://www.baidu.com" + href;

      const key = title.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);

      const n = normalizeResult({ title, url: href, snippet }, "baidu");
      if (n) {
        results.push(n);
      } else if (/^https?:\/\//i.test(href)) {
        let domain = "baidu.com";
        try {
          domain = new URL(href).hostname.replace(/^www\./, "");
        } catch {
          /* keep */
        }
        results.push({ title, url: href, snippet, source: "baidu", domain });
      }
    }
    if (results.length >= Math.min(3, num)) break;
  }

  if (results.length === 0) {
    return {
      status: "empty",
      source: "baidu",
      reason: "未解析到结果链接（页面结构可能变化）",
    };
  }
  return { status: "ok", source: "baidu", results };
}

export async function tryBing(
  query: string,
  num: number,
  timeFilter: TimeFilter,
): Promise<EngineOutcome> {
  const encoded = encodeURIComponent(query);
  const host = hasCjk(query) ? "https://cn.bing.com" : "https://www.bing.com";
  let url = `${host}/search?q=${encoded}&count=${Math.min(num + 4, 15)}`;
  if (hasCjk(query)) url += "&setlang=zh-CN&mkt=zh-CN";
  if (timeFilter) {
    const filterMap: Record<string, string> = {
      d: "ex1%3a%22ez1%22",
      w: "ex1%3a%22ez2%22",
      m: "ex1%3a%22ez3%22",
      y: "ex1%3a%22ez5_1825%22",
    };
    const f = filterMap[timeFilter];
    if (f) url += `&filters=${f}`;
  }

  const stdout = await curlGet(url, { lang: "zh-CN,zh;q=0.9,en;q=0.8" });
  if (!stdout) {
    return { status: "unavailable", source: "bing", reason: "HTTP 无响应" };
  }
  if (stdout.length < 1000) {
    return {
      status: "unavailable",
      source: "bing",
      reason: `响应过短 (${stdout.length}B)，可能被拦截`,
    };
  }

  const results: SearchResult[] = [];
  const algoRegex = /<li class="b_algo"[^>]*>/g;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = algoRegex.exec(stdout)) !== null) {
    positions.push(m.index);
  }

  for (let i = 0; i < positions.length && results.length < num; i++) {
    const start = positions[i];
    const end =
      i + 1 < positions.length
        ? positions[i + 1]
        : stdout.indexOf("</li>", start) + 5;
    const chunk = stdout.slice(start, end > start ? end : start + 3000);

    const h2Match = chunk.match(
      /<h2[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!h2Match) continue;

    const href = h2Match[1];
    const title = stripHtml(h2Match[2]);
    if (!title || title.length < 2) continue;

    const pMatch =
      chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/) ||
      chunk.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = pMatch ? stripHtml(pMatch[1]) : "";

    const dtMatch =
      chunk.match(/class="[^"]*news_dt[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
      snippet.match(
        /^(\d{4}-\d{2}-\d{2}|\d+\s*(天|日|周|月|年)前|[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/,
      );

    const n = normalizeResult(
      {
        title,
        url: href,
        snippet,
        publishedAt: dtMatch ? stripHtml(dtMatch[1]) : undefined,
      },
      "bing",
    );
    if (n) results.push(n);
  }

  if (results.length === 0) {
    return {
      status: "empty",
      source: "bing",
      reason:
        positions.length === 0
          ? "页面无 b_algo 结果块"
          : "卡片解析后 0 条有效 URL",
    };
  }
  return { status: "ok", source: "bing", results };
}

/**
 * 给 AI / 用户看的「缺什么、怎么装」说明。
 * unavailable 绝不能静默吞掉——要写进 tool message。
 */
export function formatEngineNotices(
  trails: Array<Array<{ source: string; status: EngineStatus; reason?: string }> | undefined>,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  const installHint = (source: string, reason?: string): string | null => {
    const r = (reason || "").toLowerCase();
    switch (source) {
      case "ddgr":
        if (
          r.includes("未安装") ||
          r.includes("不存在") ||
          r.includes("enoent") ||
          r.includes("not found") ||
          r.includes("可执行")
        ) {
          return [
            "[引擎不可用] ddgr 未安装或不可用（可选增强搜索 CLI，非 npm 包）。",
            "  安装后可提高免费搜索质量，例如：",
            "  · macOS: brew install ddgr",
            "  · pip:   pip install ddgr",
            "  · 或见:  https://github.com/jarun/ddgr",
            reason ? `  详情: ${reason}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        }
        return `[引擎不可用] ddgr：${reason || "执行失败"}。可检查 PATH / 重装 ddgr。`;
      case "ddg-lite":
        if (r.includes("captcha") || r.includes("风控")) {
          return `[引擎不可用] DuckDuckGo Lite 被风控/captcha：${reason}`;
        }
        return `[引擎不可用] DuckDuckGo Lite：${reason || "HTTP 失败"}（检查网络与 curl）。`;
      case "bing":
        return `[引擎不可用] Bing：${reason || "HTTP 失败"}（检查网络与 curl）。`;
      case "ddg-instant":
        return `[引擎不可用] DDG Instant Answer：${reason || "失败"}。`;
      case "baidu":
        return `[引擎不可用] 百度：${reason || "HTTP 失败"}（检查网络与 curl）。`;
      case "ddg-html":
        return `[引擎不可用] DuckDuckGo HTML：${reason || "失败"}。`;
      case "so360":
        if (r.includes("captcha") || r.includes("风控")) {
          return `[引擎不可用] 360搜索被风控/captcha：${reason}`;
        }
        return `[引擎不可用] 360搜索：${reason || "失败"}。`;
      case "sogou":
        if (r.includes("captcha") || r.includes("风控") || r.includes("验证码")) {
          return `[引擎不可用] 搜狗被风控/验证码：${reason}`;
        }
        return `[引擎不可用] 搜狗：${reason || "失败"}。`;
      case "head-token-filter":
        return `[整词过滤] ${reason || "丢弃头词假命中"}`;
      default:
        return reason
          ? `[引擎不可用] ${source}：${reason}`
          : `[引擎不可用] ${source}`;
    }
  };

  for (const trail of trails) {
    if (!trail) continue;
    for (const step of trail) {
      if (step.status !== "unavailable") continue;
      const key = `${step.source}::${step.reason || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = installHint(step.source, step.reason);
      if (line) lines.push(line);
    }
  }

  // empty 也简要告知 AI（真正「搜空才降级」的路径）
  const emptied = new Set<string>();
  for (const trail of trails) {
    if (!trail) continue;
    for (const step of trail) {
      if (step.status !== "empty") continue;
      if (emptied.has(step.source)) continue;
      emptied.add(step.source);
      lines.push(
        `[搜空已降级] ${step.source} 查询成功但 0 条${step.reason ? `（${step.reason}）` : ""}，已试下一引擎。`,
      );
    }
  }

  return lines;
}

/**
 * 通用引擎：并行多源合并 + 中文整词变体 + 头词假命中硬过滤
 *
 * 头词塌缩对策：
 *   Bing bot 对「巧乐兹…」常只返回「巧」字典页；360 易 captcha。
 *   → 少打 360、补搜狗、塌缩后二次 site: 垂直检索 + 品牌前缀回收。
 */
export async function searchFreeEngines(
  query: string,
  num: number,
  timeFilter: TimeFilter,
): Promise<{
  results: SearchResult[];
  source: string;
  trail?: Array<{ source: string; status: EngineStatus; reason?: string }>;
  dropped_head_token?: number;
} | null> {
  const trail: Array<{ source: string; status: EngineStatus; reason?: string }> = [];
  const cjk = hasCjk(query);
  const core = extractQueryCore(query);
  const coreCjk = core.replace(/[^\u4e00-\u9fff]/g, "");

  // 中文：整词变体（控制数量，避免把 360 打进 captcha）
  const variants = cjk ? phraseQueryVariants(query).slice(0, 5) : [query];
  const primary = variants[0] || query;

  const tasks: Array<Promise<EngineOutcome>> = [];
  for (const v of variants) {
    tasks.push(tryBing(v, num, timeFilter));
    if (cjk) {
      tasks.push(trySogou(v, num, timeFilter));
      tasks.push(tryBaidu(v, num, timeFilter));
    }
  }
  // 360：只打 1～2 个高价值变体，降低 qcaptcha
  if (cjk) {
    tasks.push(trySo360(primary, num, timeFilter));
    if (variants[1] && variants[1] !== primary) {
      tasks.push(trySo360(variants[1], num, timeFilter));
    }
  }
  tasks.push(tryDdgr(query, num, timeFilter));
  tasks.push(tryDdgLite(query, num, timeFilter));
  tasks.push(tryDdgHtml(query, num, timeFilter));

  const settled = await Promise.all(tasks);
  const merged: SearchResult[] = [];
  const sources: string[] = [];
  const absorb = (out: EngineOutcome) => {
    const key = `${out.source}:${out.status}:${out.reason || ""}`;
    if (!trail.some((t) => `${t.source}:${t.status}:${t.reason || ""}` === key)) {
      trail.push({ source: out.source, status: out.status, reason: out.reason });
    }
    if (out.status === "ok" && out.results?.length) {
      merged.push(...out.results);
      sources.push(out.source);
    }
  };
  for (const out of settled) absorb(out);

  // 头词塌缩 / 硬过滤后为空 → 二次垂直检索（site: + 品牌前缀）
  let { kept, dropped } = filterHeadTokenFalseHits(merged, query);
  const collapsed = isHeadTokenCollapsed(merged, query);
  if ((kept.length === 0 || collapsed) && cjk && coreCjk.length >= 3) {
    trail.push({
      source: "head-token-filter",
      status: "empty",
      reason: collapsed
        ? "引擎头词塌缩（大量字典/单字页），启动垂直二次检索"
        : "整词过滤后 0 条，启动垂直二次检索",
    });
    const rescueQueries = buildHeadTokenRescueQueries(query, coreCjk);
    const rescueTasks = rescueQueries.flatMap((rq) => [
      tryBing(rq, num, timeFilter),
      trySogou(rq, num, timeFilter),
      trySo360(rq, num, timeFilter),
    ]);
    const rescueSettled = await Promise.all(rescueTasks);
    for (const out of rescueSettled) absorb(out);
    ({ kept, dropped } = filterHeadTokenFalseHits(merged, query));
  }

  if (merged.length === 0) {
    const inst = await tryDdgInstant(query, num);
    trail.push({ source: inst.source, status: inst.status, reason: inst.reason });
    if (inst.status === "ok" && inst.results?.length) {
      const f = filterHeadTokenFalseHits(inst.results, query);
      return {
        results: f.kept.length ? f.kept : softRecoverEntityHits(inst.results, query),
        source: "ddg-instant",
        trail,
        dropped_head_token: f.dropped,
      };
    }
    return null;
  }

  // 硬过滤 —— 绝不回退未过滤 merged（禁止字典单字页回灌）
  let finalResults = kept;
  if (finalResults.length === 0 && merged.length > 0) {
    // 软回收：品牌前缀 ≥3 字可以；1～2 字头词 / 字典页绝不
    finalResults = softRecoverEntityHits(merged, query);
    if (finalResults.length > 0) {
      trail.push({
        source: "head-token-filter",
        status: "empty",
        reason: `硬过滤全灭，软回收品牌级前缀 ${finalResults.length} 条（仍无 1～2 字头词）`,
      });
    }
  }

  return {
    results: finalResults,
    source: sources.length === 1 ? sources[0]! : [...new Set(sources)].join("+"),
    trail,
    dropped_head_token: dropped,
  };
}

/** 头词塌缩后的垂直/改写查询：逼引擎离开字典页 */
function buildHeadTokenRescueQueries(query: string, coreCjk: string): string[] {
  const out: string[] = [];
  out.push(`site:bilibili.com ${coreCjk}`);
  out.push(`site:zhihu.com ${coreCjk}`);
  out.push(`site:douyin.com ${coreCjk}`);
  out.push(`${coreCjk} 是什么梗`);
  out.push(`"${coreCjk}"`);
  // 长核心：品牌 + 尾段拆分
  if (coreCjk.length >= 5) {
    const head = coreCjk.slice(0, 3);
    const tail = coreCjk.slice(3);
    out.push(`site:bilibili.com ${head} ${tail}`);
    out.push(`${head} ${tail} 梗`);
    out.push(`${head} ${tail}`);
    // 品牌单独 + 梗语境（Bing 对「巧乐兹」会塌成「巧」，site: 往往仍有效）
    out.push(`site:bilibili.com ${head}`);
    out.push(`site:zhihu.com ${head} 梗`);
  }
  // 数字核
  if (/[0-9]/.test(query)) {
    out.push(`site:nga.cn ${coreCjk}`);
    out.push(`site:bilibili.com ${coreCjk}`);
  }
  return [...new Set(out)].slice(0, 8);
}

/**
 * 360 搜索（so.com）— 中文整词召回好，但易触发 qcaptcha
 */
export async function trySo360(
  query: string,
  num: number,
  _timeFilter: TimeFilter,
): Promise<EngineOutcome> {
  const encoded = encodeURIComponent(query);
  const url = `https://www.so.com/s?q=${encoded}&pn=1`;
  const stdout = await curlGet(url, { lang: "zh-CN,zh;q=0.9" });
  if (!stdout) {
    return { status: "unavailable", source: "so360", reason: "HTTP 无响应" };
  }
  if (/qcaptcha|antispider|未找到相关结果/.test(stdout) && stdout.length < 8000) {
    return {
      status: "unavailable",
      source: "so360",
      reason: "被风控/captcha（qcaptcha）",
    };
  }
  if (stdout.length < 1500) {
    return {
      status: "unavailable",
      source: "so360",
      reason: `响应过短 (${stdout.length}B)，可能被拦截`,
    };
  }

  const results = parseSoStyleResults(stdout, num, "so360");
  if (results.length === 0) {
    return { status: "empty", source: "so360", reason: "未解析到 res-title" };
  }
  return { status: "ok", source: "so360", results };
}

/**
 * 搜狗搜索 — 中文备援，Bing 头词塌缩 / 360 captcha 时关键要
 */
export async function trySogou(
  query: string,
  num: number,
  _timeFilter: TimeFilter,
): Promise<EngineOutcome> {
  const encoded = encodeURIComponent(query);
  const url = `https://www.sogou.com/web?query=${encoded}`;
  const stdout = await curlGet(url, { lang: "zh-CN,zh;q=0.9" });
  if (!stdout) {
    return { status: "unavailable", source: "sogou", reason: "HTTP 无响应" };
  }
  if (/antispider|验证码|captcha/i.test(stdout) && stdout.length < 10000) {
    return { status: "unavailable", source: "sogou", reason: "被风控/验证码" };
  }
  if (stdout.length < 1500) {
    return {
      status: "unavailable",
      source: "sogou",
      reason: `响应过短 (${stdout.length}B)`,
    };
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // 搜狗：h3 > a，或 .vr-title / .results
  const patterns = [
    /<h3[^>]*>\s*<a[^>]+(?:href|data-url)="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]+class="[^"]*pt[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]+href="([^"]+)"[^>]*class="[^"]*pt[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stdout)) !== null && results.length < num) {
      let href = m[1] || "";
      const titleHtml = m[2] || "";
      const title = stripHtml(titleHtml);
      if (!title || title.length < 2) continue;
      if (/搜狗|登录|更多|相关搜索/.test(title) && title.length < 10) continue;

      const chunk = stdout.slice(m.index, m.index + 900);
      // 真链常在 data-url / cache 旁
      const dataUrl =
        chunk.match(/data-url="(https?:\/\/[^"]+)"/i) ||
        chunk.match(/href="(https?:\/\/(?!www\.sogou\.com)[^"]+)"/i);
      if (dataUrl) href = dataUrl[1];

      if (href.startsWith("/")) {
        // 搜狗跳转 /link?url=
        const full = href.startsWith("http") ? href : `https://www.sogou.com${href}`;
        const um = full.match(/[?&]url=([^&]+)/i);
        if (um) {
          try {
            href = decodeURIComponent(um[1]);
          } catch {
            href = full;
          }
        } else {
          href = full;
        }
      }
      if (href.startsWith("//")) href = "https:" + href;

      const abs =
        chunk.match(/class="[^"]*str-text[^"]*"[^>]*>([\s\S]*?)<\//i) ||
        chunk.match(/class="[^"]*star-wiki[^"]*"[^>]*>([\s\S]*?)<\//i) ||
        chunk.match(/class="[^"]*ft"[^>]*>([\s\S]*?)<\//i) ||
        chunk.match(/<p class="[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = abs ? stripHtml(abs[1]) : "";

      const key = title.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);

      const n = normalizeResult({ title, url: href, snippet }, "sogou");
      if (n) results.push(n);
      else if (/^https?:\/\//i.test(href) && !/sogou\.com\/web/.test(href)) {
        let domain = "sogou.com";
        try {
          domain = new URL(href).hostname.replace(/^www\./, "");
        } catch {
          /* keep */
        }
        results.push({ title, url: href, snippet, source: "sogou", domain });
      }
    }
    if (results.length >= Math.min(3, num)) break;
  }

  if (results.length === 0) {
    return { status: "empty", source: "sogou", reason: "未解析到结果" };
  }
  return { status: "ok", source: "sogou", results };
}

/** 解析 so.com 风格 h3.res-title 结果 */
function parseSoStyleResults(
  stdout: string,
  num: number,
  source: string,
): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const patterns = [
    /<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*data-mdurl="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stdout)) !== null && results.length < num) {
      let href = m[1];
      let titleHtml = m[2];
      if (m[3] && m[2] && !m[2].includes("<") && m[2].startsWith("http")) {
        href = m[2];
        titleHtml = m[3];
      } else if (m[3]) {
        titleHtml = m[3];
      }
      const chunk = stdout.slice(m.index, m.index + 800);
      const mdurl = chunk.match(/data-mdurl="(https?:\/\/[^"]+)"/i);
      if (mdurl) href = mdurl[1];

      const title = stripHtml(titleHtml);
      if (!title || title.length < 2) continue;
      if (/360|登录|更多|查看更多/.test(title) && title.length < 8) continue;

      const abs =
        chunk.match(/class="[^"]*res-list-summary[^"]*"[^>]*>([\s\S]*?)<\//i) ||
        chunk.match(/class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\//i) ||
        chunk.match(/class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\//i);
      const snippet = abs ? stripHtml(abs[1]) : "";

      if (href.startsWith("//")) href = "https:" + href;
      const key = title.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);

      const n = normalizeResult({ title, url: href, snippet }, source);
      if (n) results.push(n);
      else if (/^https?:\/\//i.test(href)) {
        let domain = "so.com";
        try {
          domain = new URL(href).hostname.replace(/^www\./, "");
        } catch {
          /* keep */
        }
        results.push({ title, url: href, snippet, source, domain });
      }
    }
    if (results.length >= Math.min(3, num)) break;
  }
  return results;
}

/**
 * 对常见官方文档站做「站内 path 猜测 + 首页/搜索页」探测（免费、无 key）。
 * 不写死答案正文，只多给 LLM 高置信文档 URL 入口。
 */
export async function tryDocsSiteSearch(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  const q = query.toLowerCase();
  const candidates: Array<{ title: string; url: string; snippet: string }> = [];

  if (/useeffect|react/.test(q)) {
    candidates.push({
      title: "useEffect – React",
      url: "https://react.dev/reference/react/useEffect",
      snippet:
        "Official React docs: useEffect setup and cleanup function; cleanup runs before re-run and on unmount.",
    });
    candidates.push({
      title: "Synchronizing with Effects – React",
      url: "https://react.dev/learn/synchronizing-with-effects",
      snippet: "Learn how Effects work, including cleanup functions.",
    });
  }
  if (/\bzod\b/.test(q) && /v4|breaking|migration|changelog/.test(q)) {
    candidates.push({
      title: "Release notes | Zod",
      url: "https://zod.dev/v4",
      snippet: "Zod 4 release notes and breaking changes overview.",
    });
    candidates.push({
      title: "Migration guide | Zod",
      url: "https://zod.dev/v4/changelog",
      snippet: "Zod 4 migration guide listing breaking changes.",
    });
  }
  if (/pnpm/.test(q) && /workspace|npm/.test(q)) {
    candidates.push({
      title: "Workspaces | pnpm",
      url: "https://pnpm.io/workspaces",
      snippet: "pnpm workspaces for monorepos; compare with npm workspaces.",
    });
    candidates.push({
      title: "pnpm vs npm",
      url: "https://pnpm.io/pnpm-vs-npm",
      snippet: "How pnpm differs from npm including linking model.",
    });
  }
  if (/opencode/.test(q)) {
    candidates.push({
      title: "OpenCode | The open source AI coding agent",
      url: "https://opencode.ai/",
      snippet: "Open source AI coding agent for terminal, IDE, or desktop.",
    });
    candidates.push({
      title: "anomalyco/opencode",
      url: "https://github.com/anomalyco/opencode",
      snippet: "The open source coding agent on GitHub.",
    });
  }
  if (/phaser/i.test(q)) {
    candidates.push({
      title: "Phaser - A fast, fun and free open source HTML5 game framework",
      url: "https://phaser.io/",
      snippet: "Official Phaser site: docs, examples, and downloads for 2D browser games.",
    });
    candidates.push({
      title: "Phaser 3 Examples",
      url: "https://phaser.io/examples",
      snippet: "Official Phaser 3 code examples including racing and physics demos.",
    });
    candidates.push({
      title: "Phaser 3 API Documentation",
      url: "https://newdocs.phaser.io/",
      snippet: "Phaser 3 official API documentation.",
    });
  }
  if (/ebiten|ebitengine/i.test(q) || (/go\b/i.test(q) && /游戏|game\s*engine|2d\s*game/i.test(q))) {
    candidates.push({
      title: "Ebitengine - A dead simple 2D game engine for Go",
      url: "https://ebitengine.org/",
      snippet: "Official Ebitengine (Ebiten) documentation and guides for Go 2D games.",
    });
    candidates.push({
      title: "hajimehoshi/ebiten",
      url: "https://github.com/hajimehoshi/ebiten",
      snippet: "Ebitengine source and examples on GitHub.",
    });
  }
  if (/godot/i.test(q)) {
    candidates.push({
      title: "Godot Engine documentation",
      url: "https://docs.godotengine.org/",
      snippet: "Official Godot Engine documentation.",
    });
  }
  if (/three\.?js|webgl/i.test(q)) {
    candidates.push({
      title: "three.js docs",
      url: "https://threejs.org/docs/",
      snippet: "Official three.js documentation.",
    });
  }

  if (candidates.length === 0) return null;
  // HEAD/GET 探测可达性，不可达则丢弃（避免死链）
  const out: SearchResult[] = [];
  await Promise.all(
    candidates.slice(0, num).map(async (c) => {
      const body = await curlGet(c.url, { timeoutSec: 8 });
      if (!body || body.length < 200) return;
      if (/404|not found|page not found/i.test(body.slice(0, 500))) return;
      const n = normalizeResult({ ...c, source: "docs-site" }, "docs-site");
      if (n) out.push(n);
    }),
  );
  return out.length ? out : null;
}

/** DuckDuckGo HTML 版（html.duckduckgo.com）— 免费、无 key */
export async function tryDdgHtml(
  query: string,
  num: number,
  _timeFilter: TimeFilter,
): Promise<EngineOutcome> {
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
  const stdout = await curlGet(url, { lang: "en-US,en;q=0.9" });
  if (!stdout) {
    return { status: "unavailable", source: "ddg-html", reason: "HTTP 无响应" };
  }
  if (/anomaly|captcha|unusual traffic/i.test(stdout.slice(0, 1500))) {
    return { status: "unavailable", source: "ddg-html", reason: "被风控/captcha" };
  }

  const results: SearchResult[] = [];
  // result__a 链接
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snipRe =
    /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  // snippets often in <a class="result__snippet">
  const blocks = stdout.split(/class="result[^"]*"/i);
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null && results.length < num) {
    let href = m[1];
    const title = stripHtml(m[2]);
    if (!title || title.length < 2) continue;
    // uddg redirect
    try {
      const u = new URL(href.startsWith("//") ? "https:" + href : href, "https://duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      if (uddg) href = decodeURIComponent(uddg);
    } catch {
      /* keep */
    }
    const after = stdout.slice(m.index, m.index + 1200);
    const sm = after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
    const snippet = sm ? stripHtml(sm[1]) : "";
    const n = normalizeResult({ title, url: href, snippet }, "ddg-html");
    if (n) results.push(n);
  }

  if (results.length === 0) {
    return { status: "empty", source: "ddg-html", reason: "未解析到 result__a" };
  }
  return { status: "ok", source: "ddg-html", results };
}

/** 释义/技术类 query 自动扩展，提高定义页与官方文档召回 */
export function expandExplainQueries(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const out = [q];
  // 纯中文「是什么」类：扩释义词；含英文技术词时不要乱加「谐音」
  const mostlyZh = /[\u4e00-\u9fff]/.test(q) && !/[a-z]{3,}/i.test(q.replace(/yolo|mode|agent|coding/gi, ""));
  if (/是什么梗|什么意思|什么是|谐音|出处|起源|全文|怎么死了|怎么没了/.test(q) && mostlyZh) {
    // 与 entity 过滤同源：先剥问句尾巴再扩展，避免带着「是什么梗」重复
    const core = extractQueryCore(q);
    const cjk = core.replace(/[^\u4e00-\u9fff]/g, "");
    if (cjk.length >= 2) {
      out.push(`${cjk} 是什么意思`);
      out.push(`${cjk} 谐音`);
      out.push(`${cjk} 出处`);
      out.push(`"${cjk}"`);
      // 长梗：双段检索，逼引擎同时看到前后实体
      if (cjk.length >= 5) {
        out.push(`${cjk.slice(0, 3)} ${cjk.slice(3)} 梗`);
        out.push(`"${cjk.slice(0, 3)}" "${cjk.slice(3)}"`);
      }
    }
  } else if (/是什么意思|是什么|什么意思/.test(q) && /[a-z]{3,}/i.test(q)) {
    // 中英混合释义：保留原 query，另加英文 definition 向扩展
    const core = q.replace(/(是什么意思|是什么|什么意思)/g, "").trim();
    if (core.length >= 3) out.push(`${core} meaning`);
  }
  if (/yolo\s*mode|yolo mode|yolo 模式/i.test(q) || (/\byolo\b/i.test(q) && /agent|coding|cursor|claude/i.test(q))) {
    out.push("coding agent YOLO mode auto accept without confirmation");
    out.push("Cursor YOLO Mode auto-run terminal");
    out.push("Claude Code YOLO mode permissions");
    out.push("You Only Look Once coding agent skip approval");
  }
  if (/useeffect/i.test(q) && /cleanup/i.test(q)) {
    out.push("site:react.dev useEffect cleanup");
    out.push("useEffect cleanup function unmount");
  }
  if (/\bzod\b/i.test(q) && /v4|breaking/i.test(q)) {
    out.push("site:zod.dev v4 breaking changes");
    out.push("zod v4 migration guide changelog");
  }
  if (/pnpm/i.test(q) && /npm/i.test(q) && /workspace/i.test(q)) {
    out.push("site:pnpm.io workspaces vs npm");
    out.push("pnpm workspace monorepo 硬链接");
  }
  if (/opencode/i.test(q)) {
    out.push("site:github.com/anomalyco/opencode");
    out.push("site:opencode.ai");
  }
  return [...new Set(out)].slice(0, 5);
}

// ── 分类原生 API（合并，不短路）──────────────────────────────

export async function searchCategoryApis(
  query: string,
  num: number,
  category: string,
): Promise<SearchResult[]> {
  const tasks: Promise<SearchResult[] | null>[] = [];
  switch (category) {
    case "coding":
      tasks.push(
        tryGitHubApi(query, num, "repositories"),
        tryStackExchangeApi(query, num),
        tryNpmSearchApi(query, num),
        tryMdnSearchApi(query, num),
        tryCratesIoApi(query, num),
        tryPkgGoDevApi(query, num),
        // 文档站直搜（免费 HTML，补 SERP 跑偏）
        tryDocsSiteSearch(query, num),
      );
      // issues 仅在排障意图时启用，避免 bounty/噪声 issue 霸榜
      if (/\b(issue|bug|error|crash|fail|exception|stacktrace|报错|失败)\b/i.test(query)) {
        tasks.push(tryGitHubApi(query, num, "issues"));
      }
      break;
    case "tools":
      tasks.push(
        tryGitHubApi(query, num, "repositories"),
        tryDockerHubApi(query, num),
        tryDevToApi(query, num),
      );
      break;
    case "academic":
      tasks.push(tryArxivApi(query, num), tryWikipediaApi(query, num));
      break;
    case "knowledge":
      tasks.push(tryHnAlgoliaApi(query, num), tryStackExchangeApi(query, num));
      break;
    case "news":
      tasks.push(tryHnAlgoliaApi(query, num), tryGoogleNewsRssApi(query, num));
      break;
    case "video":
      tasks.push(tryYoutubeSearch(query, num));
      break;
    default:
      return [];
  }

  const settled = await Promise.all(tasks);
  const merged: SearchResult[] = [];
  for (const r of settled) {
    if (r?.length) merged.push(...r);
  }
  return merged;
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** 把自然语言 query 压成 GitHub 搜索友好关键词 */
function compressGitHubQuery(query: string, type: "repositories" | "issues"): string {
  const stop = new Set([
    "best",
    "top",
    "the",
    "a",
    "an",
    "of",
    "for",
    "with",
    "and",
    "or",
    "in",
    "on",
    "to",
    "how",
    "what",
    "is",
    "are",
    "2024",
    "2025",
    "2026",
  ]);
  const tokens = query
    .split(/[^a-z0-9_+#.-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stop.has(t.toLowerCase()))
    .slice(0, 6);
  let q = tokens.join(" ");
  if (!q) q = query.slice(0, 80);
  if (type === "issues") q += " is:issue";
  return q;
}

export async function tryGitHubApi(
  query: string,
  num: number,
  type: "repositories" | "issues",
): Promise<SearchResult[] | null> {
  try {
    // GitHub 搜索对长自然语言不友好：压缩为关键词 + 可选 in:name,description
    const ghQuery = compressGitHubQuery(query, type);
    const encoded = encodeURIComponent(ghQuery);
    let url: string;
    if (type === "repositories") {
      url = `https://api.github.com/search/repositories?q=${encoded}&sort=stars&order=desc&per_page=${Math.min(num, 10)}`;
    } else {
      url = `https://api.github.com/search/issues?q=${encoded}&sort=updated&order=desc&per_page=${Math.min(num, 10)}`;
    }
    const stdout = await curlGet(url, { headers: githubHeaders() });
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    if (data.message && !data.items) return null;
    const items = data.items ?? [];
    if (items.length === 0) return null;

    return mapNormalized(
      items.map((item: Record<string, unknown>) => {
        if (type === "repositories") {
          return {
            title: String(item.full_name || ""),
            url: String(item.html_url || ""),
            snippet: `⭐${item.stargazers_count || 0} · 更新 ${String(item.updated_at || "").slice(0, 10)} · ${String(item.description || "").slice(0, 140)}`,
            publishedAt: item.updated_at
              ? String(item.updated_at).slice(0, 10)
              : item.pushed_at
                ? String(item.pushed_at).slice(0, 10)
                : undefined,
          };
        }
        return {
          title: String(item.title || ""),
          url: String(item.html_url || ""),
          snippet: `💬${item.comments || 0} · ${String(item.body || "").slice(0, 140).replace(/\r?\n/g, " ")}`,
          publishedAt: item.updated_at
            ? String(item.updated_at).slice(0, 10)
            : item.created_at
              ? String(item.created_at).slice(0, 10)
              : undefined,
        };
      }),
      "github-api",
    );
  } catch {
    return null;
  }
}

export async function tryArxivApi(query: string, num: number): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `http://export.arxiv.org/api/query?search_query=all:${encoded}&max_results=${Math.min(num, 10)}&sortBy=submittedDate&sortOrder=descending`;
    const stdout = await curlGet(url);
    if (!stdout || !stdout.includes("<entry>")) return null;

    const results: Array<{ title: string; url: string; snippet: string; publishedAt?: string }> =
      [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let m: RegExpExecArray | null;
    while ((m = entryRegex.exec(stdout)) !== null && results.length < num) {
      const chunk = m[1];
      const titleMatch = chunk.match(/<title>([\s\S]*?)<\/title>/);
      const idMatch = chunk.match(/<id>([\s\S]*?)<\/id>/);
      const summaryMatch = chunk.match(/<summary>([\s\S]*?)<\/summary>/);
      const publishedMatch = chunk.match(/<published>([\s\S]*?)<\/published>/);
      if (titleMatch && idMatch) {
        results.push({
          title: titleMatch[1].replace(/\n/g, " ").trim(),
          url: idMatch[1].trim().replace("http://", "https://"),
          snippet: summaryMatch
            ? summaryMatch[1].replace(/\n/g, " ").trim().slice(0, 200)
            : "",
          publishedAt: publishedMatch
            ? normalizeDateString(publishedMatch[1].trim())
            : undefined,
        });
      }
    }
    const out = mapNormalized(results, "arxiv-api");
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export async function tryWikipediaApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&srlimit=${Math.min(num, 10)}`;
    const stdout = await curlGet(url);
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const items = data.query?.search ?? [];
    if (items.length === 0) return null;
    return mapNormalized(
      items.map((item: Record<string, unknown>) => ({
        title: String(item.title || ""),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || "")).replace(/%20/g, "_")}`,
        snippet: stripHtml(String(item.snippet || "")).slice(0, 200),
        publishedAt: item.timestamp ? String(item.timestamp).slice(0, 10) : undefined,
      })),
      "wikipedia-api",
    );
  } catch {
    return null;
  }
}

export async function tryHnAlgoliaApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://hn.algolia.com/api/v1/search?query=${encoded}&tags=story&hitsPerPage=${Math.min(num, 20)}`;
    const stdout = await curlGet(url);
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const items = data.hits ?? [];
    if (items.length === 0) return null;
    return mapNormalized(
      items.map((item: Record<string, unknown>) => ({
        title: String(item.title || ""),
        url: String(item.url || `https://news.ycombinator.com/item?id=${item.objectID || ""}`),
        snippet: `points: ${item.points || 0} · comments: ${item.num_comments || 0}`,
        publishedAt:
          typeof item.created_at_i === "number"
            ? new Date((item.created_at_i as number) * 1000).toISOString().slice(0, 10)
            : item.created_at
              ? String(item.created_at).slice(0, 10)
              : undefined,
      })),
      "hn-api",
    );
  } catch {
    return null;
  }
}

export async function tryYoutubeSearch(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://www.youtube.com/results?search_query=${encoded}&sp=CAI%253D`; // 按上传日期倾向
    const stdout = await curlGet(url);
    if (!stdout) return null;

    const marker = "var ytInitialData = ";
    const startIdx = stdout.indexOf(marker);
    if (startIdx < 0) return null;
    const jsonStart = startIdx + marker.length;
    let depth = 0;
    let jsonEnd = -1;
    let inString = false;
    let escape = false;
    for (let i = jsonStart; i < stdout.length; i++) {
      const ch = stdout[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
    if (jsonEnd < 0) return null;

    const data = JSON.parse(stdout.slice(jsonStart, jsonEnd));
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents?.[0]?.itemSectionRenderer?.contents ?? [];

    const items: Array<{ title: string; url: string; snippet: string; publishedAt?: string }> =
      [];
    for (const item of contents) {
      if (items.length >= num) break;
      const video = item.videoRenderer;
      if (!video) continue;
      const published = video.publishedTimeText?.simpleText;
      items.push({
        title: video.title?.runs?.[0]?.text || "",
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
        snippet: `${video.ownerText?.runs?.[0]?.text || ""} · ${video.lengthText?.simpleText || ""} · ${video.viewCountText?.simpleText || ""}${published ? " · " + published : ""}`,
        publishedAt: published || undefined,
      });
    }
    const out = mapNormalized(items, "youtube");
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export async function tryStackExchangeApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encoded}&site=stackoverflow&pagesize=${Math.min(num, 10)}&filter=withbody`;
    const stdout = await curlGet(url);
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const items = data.items ?? [];
    if (items.length === 0) return null;
    return mapNormalized(
      items.map((item: Record<string, unknown>) => ({
        title: String(item.title || ""),
        url: String(item.link || ""),
        snippet: `score: ${item.score || 0} · tags: ${((item.tags as string[]) || []).join(", ")} · ${stripHtml(String(item.body || "")).slice(0, 140)}`,
        publishedAt:
          typeof item.last_activity_date === "number"
            ? new Date((item.last_activity_date as number) * 1000).toISOString().slice(0, 10)
            : typeof item.creation_date === "number"
              ? new Date((item.creation_date as number) * 1000).toISOString().slice(0, 10)
              : undefined,
      })),
      "stackexchange-api",
    );
  } catch {
    return null;
  }
}

export async function tryNpmSearchApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://registry.npmjs.org/-/v1/search?text=${encoded}&size=${Math.min(num, 10)}`;
    const stdout = await curlGet(url);
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const items = data.objects ?? [];
    if (items.length === 0) return null;
    return mapNormalized(
      items.map((obj: Record<string, unknown>) => {
        const pkg = (obj.package as Record<string, unknown>) ?? {};
        const links = (pkg.links as Record<string, unknown>) ?? {};
        const date = pkg.date ? String(pkg.date).slice(0, 10) : undefined;
        return {
          title: String(pkg.name || ""),
          url: String(links.npm || `https://www.npmjs.com/package/${pkg.name}`),
          snippet: `v${pkg.version || "?"} · ${String(pkg.description || "").slice(0, 150)}`,
          publishedAt: date,
        };
      }),
      "npm-api",
    );
  } catch {
    return null;
  }
}

export async function tryMdnSearchApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://developer.mozilla.org/api/v1/search?q=${encoded}&locale=en-US`;
    const stdout = await curlGet(url);
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const items = data.documents ?? [];
    if (items.length === 0) return null;
    return mapNormalized(
      items.slice(0, num).map((item: Record<string, unknown>) => ({
        title: String(item.title || ""),
        url: `https://developer.mozilla.org/en-US/docs/${String(item.slug || "")}`,
        snippet: String(item.summary || "").slice(0, 200),
      })),
      "mdn-api",
    );
  } catch {
    return null;
  }
}

export async function tryCratesIoApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://crates.io/api/v1/crates?q=${encoded}&per_page=${Math.min(num, 10)}&sort=recent-downloads`;
    const stdout = await curlGet(url, {
      headers: { "User-Agent": "maou-agent/1.0 (https://github.com/little-house-studio)" },
    });
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const items = data.crates ?? [];
    if (items.length === 0) return null;
    return mapNormalized(
      items.map((item: Record<string, unknown>) => ({
        title: String(item.name || ""),
        url: `https://crates.io/crates/${item.name}`,
        snippet: `v${item.max_version || "?"} · downloads: ${item.downloads || 0} · ${String(item.description || "").slice(0, 120)}`,
        publishedAt: item.updated_at ? String(item.updated_at).slice(0, 10) : undefined,
      })),
      "crates-api",
    );
  } catch {
    return null;
  }
}

export async function tryPkgGoDevApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://pkg.go.dev/v1beta/search?q=${encoded}`;
    const stdout = await curlGet(url);
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const items = data.results ?? [];
    if (items.length === 0) return null;
    return mapNormalized(
      items.slice(0, num).map((item: Record<string, unknown>) => {
        const pkgs = item.packages as Record<string, unknown>[] | undefined;
        const pkg = pkgs?.[0] ?? item;
        return {
          title: String(pkg.path || item.name || ""),
          url: `https://pkg.go.dev/${pkg.path || item.name || ""}`,
          snippet: String(pkg.synopsis || pkg.module || item.name || "").slice(0, 200),
        };
      }),
      "pkggo-api",
    );
  } catch {
    return null;
  }
}

export async function tryDockerHubApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://hub.docker.com/v2/search/repositories/?query=${encoded}&page_size=${Math.min(num, 10)}`;
    const stdout = await curlGet(url);
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    const items = data.results ?? [];
    if (items.length === 0) return null;
    return mapNormalized(
      items.map((item: Record<string, unknown>) => ({
        title: String(item.repo_name || ""),
        url: `https://hub.docker.com/r/${item.repo_name || ""}`,
        snippet: `⭐${item.star_count || 0} · ${String(item.short_description || "").slice(0, 150)}`,
      })),
      "dockerhub-api",
    );
  } catch {
    return null;
  }
}

export async function tryDevToApi(query: string, num: number): Promise<SearchResult[] | null> {
  try {
    // 用 search 端点比纯 tag 更靠谱
    const encoded = encodeURIComponent(query);
    const url = `https://dev.to/search/feed_content?per_page=${Math.min(num, 10)}&page=0&class_name=Article&search_fields=${encoded}`;
    let stdout = await curlGet(url, {
      headers: { Accept: "application/json" },
    });
    if (stdout) {
      try {
        const data = JSON.parse(stdout);
        const items = data.result ?? data;
        if (Array.isArray(items) && items.length > 0) {
          return mapNormalized(
            items.slice(0, num).map((item: Record<string, unknown>) => {
              const path = String(item.path || "");
              return {
                title: String(item.title || ""),
                url: path.startsWith("http") ? path : `https://dev.to${path}`,
                snippet: String(item.class_name || "Article"),
                publishedAt: item.published_at_int
                  ? new Date(Number(item.published_at_int) * 1000).toISOString().slice(0, 10)
                  : undefined,
              };
            }),
            "devto-api",
          );
        }
      } catch {
        /* fallthrough */
      }
    }

    // 回退：按首词 tag
    const tag = query.split(/\s+/)[0].toLowerCase();
    stdout = await curlGet(
      `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=${Math.min(num, 10)}`,
    );
    if (!stdout) return null;
    const data = JSON.parse(stdout);
    if (!Array.isArray(data) || data.length === 0) return null;
    return mapNormalized(
      data.map((item: Record<string, unknown>) => ({
        title: String(item.title || ""),
        url: String(item.url || ""),
        snippet: `❤️${item.positive_reactions_count || 0} · ${String(item.description || "").slice(0, 120)}`,
        publishedAt: item.published_at ? String(item.published_at).slice(0, 10) : undefined,
      })),
      "devto-api",
    );
  } catch {
    return null;
  }
}

export async function tryGoogleNewsRssApi(
  query: string,
  num: number,
): Promise<SearchResult[] | null> {
  try {
    // 时效：加 when:7d 类操作符（Google News 支持）
    const encoded = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
    const stdout = await curlGet(url);
    if (!stdout || !stdout.includes("<item>")) return null;

    const items: Array<{ title: string; url: string; snippet: string; publishedAt?: string }> =
      [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(stdout)) !== null && items.length < num) {
      const chunk = m[1];
      const titleMatch =
        chunk.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
        chunk.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = chunk.match(/<link>([\s\S]*?)<\/link>/);
      const descMatch =
        chunk.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
        chunk.match(/<description>([\s\S]*?)<\/description>/);
      const pubMatch = chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      if (titleMatch && linkMatch) {
        items.push({
          title: titleMatch[1].trim(),
          url: linkMatch[1].trim(),
          snippet: descMatch ? stripHtml(descMatch[1]).slice(0, 200) : "",
          publishedAt: pubMatch ? normalizeDateString(pubMatch[1].trim()) : undefined,
        });
      }
    }
    const out = mapNormalized(items, "google-news-rss");
    return out.length ? out : null;
  } catch {
    return null;
  }
}
