/**
 * 查询主体抽取 + 整词/实体命中检测
 *
 * 根因（「只能搜到头词」）：
 *   1. 免费 SERP（Bing bot / 百度反爬 / 部分 HTML）对中文长 query 做字级/词头切分，
 *      把「巧乐兹火车头」打成「巧」并高排词典页。
 *   2. 若后处理只做关键词 OR 覆盖、不强制「连续多字实体」与「覆盖率」，
 *      头词假命中会冒充相关结果进入 Agent 上下文。
 *   3. 数字黑话（飞8分钱）若在 URL 数字上误命中、或去数字后匹配「飞分钱」，
 *      会串到「让子弹飞分钱」等完全不同梗。
 *
 * 修复原则：
 *   - 多字 CJK 核心：必须命中足够长的连续子串，或「前缀实体 + 后缀」共现覆盖。
 *   - 长核心（≥5）：仅命中 3 字头实体（如只有「巧乐兹」）→ 弱分，不视为整词命中。
 *   - 词典/单字百科页：硬丢弃。
 *   - 数字核：只在 title+snippet 上判，支持 八↔8，禁止只靠 URL 里的数字。
 */

/** 抽掉问句尾巴，得到检索主体 */
export function extractQueryCore(query: string): string {
  let q = query.trim();
  q = q.replace(/\s+/g, " ");
  // 中文问句尾巴（尽量保序、一次剥干净）
  q = q.replace(
    /(是什么梗|什么梗|是什么意思|什么意思|全文是什么|全文|怎么死了|怎么没了|怎么倒闭|怎么了|为什么很多人恶搞|为什么恶搞|为什么|如何|是什么|有哪些|哪些|好用的|开源|项目|github).*$/gi,
    "",
  );
  q = q.replace(/^(什么是|谁是|哪个|有没有)/, "");
  q = q.replace(/[?？!！。,.，、\s]+$/g, "").trim();
  return q;
}

/** 从主体中提取「必须命中」的 CJK 实体片段（长度 ≥3） */
export function requiredCjkSpans(core: string): string[] {
  const cjk = core.replace(/[^\u4e00-\u9fff]/g, "");
  if (cjk.length < 3) return cjk.length >= 2 ? [cjk] : [];
  const spans: string[] = [cjk];
  for (let n = Math.min(6, cjk.length); n >= 3; n--) {
    for (let i = 0; i <= cjk.length - n; i++) {
      spans.push(cjk.slice(i, i + n));
    }
  }
  return [...new Set(spans)];
}

const CN_DIGIT: Record<string, string> = {
  "0": "零",
  "1": "一",
  "2": "二",
  "3": "三",
  "4": "四",
  "5": "五",
  "6": "六",
  "7": "七",
  "8": "八",
  "9": "九",
};

/** 数字汉字互转变体（飞8分钱 ↔ 飞八分钱） */
export function digitCoreVariants(core: string): string[] {
  const out = new Set<string>([core, core.replace(/\s+/g, "")]);
  let cn = core;
  let ar = core;
  for (const [d, c] of Object.entries(CN_DIGIT)) {
    cn = cn.split(d).join(c);
    ar = ar.split(c).join(d);
  }
  out.add(cn);
  out.add(ar);
  out.add(cn.replace(/\s+/g, ""));
  out.add(ar.replace(/\s+/g, ""));
  return [...out].filter(Boolean);
}

/**
 * 结果是否「整词命中」主体（非仅头字）
 * 返回 0..1，0 = 假命中应硬过滤
 *
 * @param text 建议传入 title + snippet（不要只靠 URL）
 * @param query 原始用户 query
 * @param opts.url 可选；仅作弱信号，数字核不用 URL 判命中
 */
export function entityHitScore(
  text: string,
  query: string,
  opts?: { url?: string },
): { score: number; matched?: string; reason?: string; coverage?: number } {
  const titleSnip = (text || "").toLowerCase();
  const core = extractQueryCore(query);
  if (!core) return { score: 0.5, reason: "empty-core" };

  const coreNorm = core.toLowerCase().replace(/\s+/g, "");
  // 正文：去空白便于连续匹配；URL 单独、且弱
  const hayBody = titleSnip.replace(/[\s_\-·|]+/g, "");
  const hayUrl = (opts?.url || "").toLowerCase();

  // ── 含数字的黑话主体（飞8分钱）────────────────────────────────
  if (/[0-9]/.test(core) && /[\u4e00-\u9fff]/.test(core)) {
    const variants = digitCoreVariants(coreNorm);
    for (const v of variants) {
      if (hayBody.includes(v.toLowerCase())) {
        return { score: 1, matched: v, coverage: 1 };
      }
    }
    // 数字两侧汉字均在正文中，且数字（或汉字数字）也在正文——禁止只靠 URL
    const parts = coreNorm.split(/(\d+)/).filter(Boolean);
    if (parts.length >= 3) {
      const bodyOk = parts.every((p) => {
        if (/^\d+$/.test(p)) {
          // 阿拉伯数字或其汉字形式须出现在正文
          const cnForm = [...p].map((ch) => CN_DIGIT[ch] || ch).join("");
          return hayBody.includes(p) || hayBody.includes(cnForm);
        }
        return hayBody.includes(p);
      });
      if (bodyOk) {
        return { score: 0.9, matched: parts.join(""), coverage: 1 };
      }
    }
    return { score: 0, reason: `digit-core-miss: need "${core}" in title/snippet` };
  }

  // ── 中文多字主体 ────────────────────────────────────────────
  const cjk = core.replace(/[^\u4e00-\u9fff]/g, "");
  if (cjk.length >= 3) {
    if (hayBody.includes(cjk) || titleSnip.includes(cjk)) {
      return { score: 1, matched: cjk, coverage: 1 };
    }

    // 收集所有 ≥3 连续子串命中，算核心字符覆盖率
    type SpanHit = { span: string; start: number; len: number };
    const hits: SpanHit[] = [];
    for (let n = Math.min(8, cjk.length); n >= 3; n--) {
      for (let i = 0; i <= cjk.length - n; i++) {
        const span = cjk.slice(i, i + n);
        if (hayBody.includes(span) || titleSnip.includes(span)) {
          hits.push({ span, start: i, len: n });
        }
      }
    }

    if (hits.length === 0) {
      const head2 = cjk.slice(0, 2);
      if (hayBody.includes(head2) || hayBody.includes(cjk[0]!)) {
        return {
          score: 0,
          reason: `head-token-only: core="${cjk}" but only head matched`,
          coverage: 0,
        };
      }
      // URL 里偶发实体 slug：弱分，不硬通过
      if (hayUrl && (hayUrl.includes(encodeURIComponent(cjk.slice(0, 3))) || [...cjk].every((ch) => hayUrl.includes(ch)))) {
        return { score: 0.15, reason: "url-only-weak", coverage: 0.2 };
      }
      return { score: 0, reason: `no-core-span: core="${cjk}"`, coverage: 0 };
    }

    const covered = new Set<number>();
    let longest = hits[0]!;
    for (const h of hits) {
      if (h.len > longest.len) longest = h;
      for (let k = 0; k < h.len; k++) covered.add(h.start + k);
    }
    const coverage = covered.size / cjk.length;

    // 完整或近完整
    if (longest.len >= cjk.length) {
      return { score: 1, matched: longest.span, coverage: 1 };
    }
    // 覆盖率高：如「巧乐兹」+「火车头」= 6/6
    if (coverage >= 0.99) {
      return { score: 0.95, matched: hits.map((h) => h.span).join("+"), coverage };
    }
    if (coverage >= 0.66 && longest.len >= 3) {
      return {
        score: Math.min(0.92, 0.7 + coverage * 0.25 + longest.len * 0.02),
        matched: hits.map((h) => h.span).join("+"),
        coverage,
      };
    }
    // 长核心（≥5）：最长仅 3 且覆盖不足一半
    // → 若是核心前缀品牌（巧乐兹⊂巧乐兹火车头）给弱分，便于召回且绝不等于单字「巧」
    // → 非前缀的 3 字碎片仍视为 0
    if (cjk.length >= 5 && longest.len <= 3 && coverage < 0.55) {
      if (longest.len >= 3 && cjk.startsWith(longest.span)) {
        return {
          score: 0.38,
          matched: longest.span,
          reason: `brand-prefix-only: matched="${longest.span}" core="${cjk}"`,
          coverage,
        };
      }
      return {
        score: 0,
        reason: `partial-head-entity: matched="${longest.span}" core="${cjk}" coverage=${coverage.toFixed(2)}`,
        coverage,
      };
    }
    // 4 字核心命中 3 字：可接受但非满分
    if (longest.len >= 4) {
      return {
        score: Math.min(1, 0.62 + longest.len * 0.08 + coverage * 0.15),
        matched: longest.span,
        coverage,
      };
    }
    if (longest.len >= 3) {
      // 3～4 字核心整段 3 字命中
      if (cjk.length <= 4) {
        return {
          score: Math.min(1, 0.55 + longest.len * 0.1 + coverage * 0.2),
          matched: longest.span,
          coverage,
        };
      }
      // 更长核心、覆盖尚可
      if (coverage >= 0.5) {
        return { score: 0.72, matched: longest.span, coverage };
      }
      return {
        score: 0,
        reason: `weak-span: matched="${longest.span}" core="${cjk}" coverage=${coverage.toFixed(2)}`,
        coverage,
      };
    }
    return { score: 0, reason: `no-core-span: core="${cjk}"`, coverage: 0 };
  }

  // ── 英文/混合：显著 token 覆盖 ──────────────────────────────
  const tokens = core
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff.+#-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
  if (tokens.length === 0) return { score: 0.5 };
  let hit = 0;
  for (const t of tokens) {
    if (hayBody.includes(t) || titleSnip.includes(t)) hit++;
  }
  const ratio = hit / tokens.length;
  if (ratio < 0.34 && tokens.length >= 2) {
    return { score: 0, reason: `token-coverage-too-low:${ratio.toFixed(2)}` };
  }
  return {
    score: ratio,
    matched: tokens.filter((t) => hayBody.includes(t) || titleSnip.includes(t)).join("+"),
    coverage: ratio,
  };
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "and",
  "or",
  "is",
  "are",
  "what",
  "how",
  "why",
  "best",
  "mode",
  "的",
  "和",
  "与",
  "在",
  "是",
  "有",
  "了",
  "吗",
  "呢",
]);

/** 词典/单字百科页特征 */
export function looksLikeDictionaryHeadwordPage(title: string, url: string): boolean {
  const t = title || "";
  const u = url || "";
  if (/[（(]汉字[）)]|汉典|新华字典|说文解字|汉语国学|zidian|字典|词典|辞书/.test(t + u)) {
    return true;
  }
  if (
    /baike\.baidu\.com\/item\/.+/.test(u) &&
    /^[\u4e00-\u9fff]{1,2}\s*[（(_]/.test(t.replace(/<[^>]+>/g, ""))
  ) {
    return true;
  }
  const cjkOnly = t.replace(/[^\u4e00-\u9fff]/g, "");
  if (cjkOnly.length > 0 && cjkOnly.length <= 2 && /百科|字典|词典|拼音|笔顺/.test(t)) {
    return true;
  }
  return false;
}

/**
 * 过滤假命中：多字实体 query 下丢弃头词词典页与弱覆盖结果
 * 默认硬过滤 score<=0；绝不为了「有结果」放回词典污染。
 */
export function filterHeadTokenFalseHits<T extends { title: string; url: string; snippet?: string }>(
  results: T[],
  query: string,
  opts?: { minScore?: number },
): { kept: T[]; dropped: number; dropReasons: string[] } {
  const minScore = opts?.minScore ?? 0.01;
  const core = extractQueryCore(query);
  const cjk = core.replace(/[^\u4e00-\u9fff]/g, "");
  const needStrict = cjk.length >= 3 || (/[0-9]/.test(core) && /[\u4e00-\u9fff]/.test(core));

  const kept: T[] = [];
  let dropped = 0;
  const dropReasons: string[] = [];
  for (const r of results) {
    const body = `${r.title} ${r.snippet || ""}`;
    if (looksLikeDictionaryHeadwordPage(r.title, r.url) && needStrict) {
      const hit = entityHitScore(body, query, { url: r.url });
      if (hit.score < 0.5) {
        dropped++;
        dropReasons.push(hit.reason || "dictionary-headword");
        continue;
      }
    }
    if (needStrict) {
      const hit = entityHitScore(body, query, { url: r.url });
      if (hit.score < minScore) {
        dropped++;
        dropReasons.push(hit.reason || "entity-miss");
        continue;
      }
    }
    kept.push(r);
  }
  return { kept, dropped, dropReasons };
}

/**
 * 软回收：硬过滤全灭时，允许「覆盖率≥0.45 且最长 span≥3」的结果，
 * 仍禁止词典单字页与 score=0 头词。
 */
/**
 * 软回收策略（仅在硬过滤后 0 条时使用）：
 * 1. score>0 的正常结果
 * 2. 长核心的「品牌级前缀」(≥3 字，如 巧乐兹⊂巧乐兹火车头) — 绝不是 1～2 字词典头词
 * 3. 数字核 / head-token-only / 词典页 — 永不回收
 */
export function softRecoverEntityHits<T extends { title: string; url: string; snippet?: string }>(
  results: T[],
  query: string,
): T[] {
  const core = extractQueryCore(query);
  const cjk = core.replace(/[^\u4e00-\u9fff]/g, "");
  const isDigitCore = /[0-9]/.test(core) && /[\u4e00-\u9fff]/.test(core);
  if (cjk.length < 3 && !isDigitCore) {
    return results;
  }
  const out: T[] = [];
  for (const r of results) {
    if (looksLikeDictionaryHeadwordPage(r.title, r.url)) continue;
    const body = `${r.title} ${r.snippet || ""}`;
    const hit = entityHitScore(body, query, { url: r.url });
    if (hit.score > 0) {
      out.push(r);
      continue;
    }
    if (isDigitCore) continue;
    if (hit.reason?.startsWith("head-token-only")) continue;
    // brand-prefix-only 现已有弱分（score≈0.38），上面 hit.score>0 已覆盖。
    // 仍拒绝 partial-head-entity / head-token-only。
  }
  return out;
}

/** 引擎结果是否「头词塌缩」：多数字典/单字页，整词实体全灭 */
export function isHeadTokenCollapsed<T extends { title: string; url: string; snippet?: string }>(
  results: T[],
  query: string,
): boolean {
  if (results.length === 0) return false;
  const core = extractQueryCore(query);
  const cjk = core.replace(/[^\u4e00-\u9fff]/g, "");
  if (cjk.length < 3) return false;
  let bad = 0;
  for (const r of results) {
    if (looksLikeDictionaryHeadwordPage(r.title, r.url)) {
      bad++;
      continue;
    }
    const hit = entityHitScore(`${r.title} ${r.snippet || ""}`, query, { url: r.url });
    if (hit.score <= 0) bad++;
  }
  return bad / results.length >= 0.7;
}

/** 为中文主体生成带引号/切分的精确检索变体（逼引擎别只搜头字） */
export function phraseQueryVariants(query: string): string[] {
  const core = extractQueryCore(query);
  const cjk = core.replace(/[^\u4e00-\u9fff]/g, "");
  const out: string[] = [];

  // 优先整词引号（多数引擎对引号更尊重）
  if (cjk.length >= 3) {
    out.push(`"${cjk}"`);
    out.push(cjk);
    out.push(`"${cjk}" 是什么梗`);
    out.push(`${cjk} 梗`);
    // 长核心：切成「前实体 + 后段」双词，避免只命中头三字
    if (cjk.length >= 5) {
      const head = cjk.slice(0, 3);
      const tail = cjk.slice(3);
      out.push(`${head} ${tail}`);
      out.push(`"${head}" "${tail}"`);
      out.push(`${head}${tail} 是什么梗`);
      if (cjk.length >= 6) {
        out.push(`"${cjk.slice(0, 4)}"`);
        out.push(`${cjk.slice(0, 3)} ${cjk.slice(3)} 梗`);
      }
    }
  }

  // 数字核变体
  if (/[0-9]/.test(core) && /[\u4e00-\u9fff]/.test(core)) {
    for (const v of digitCoreVariants(core)) {
      out.push(v);
      out.push(`"${v}"`);
      out.push(`${v} 是什么梗`);
    }
  }

  // 原 query 垫后（避免头词主导）
  out.push(query.trim());

  return [...new Set(out.filter(Boolean))].slice(0, 8);
}
