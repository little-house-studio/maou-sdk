#!/usr/bin/env node
/**
 * Free-path search_internet benchmark harness.
 * Usage (from core/tools): node scripts/search-bench.mjs [outDir]
 * Requires: package built (dist/), network/curl. No paid API keys.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(process.argv[2] || resolve(root, "bench-out"));
mkdirSync(outDir, { recursive: true });

const { InternetSearchTool } = await import(
  resolve(root, "dist/internet/search_internet/tool.js")
);

const suite = {
  queries: [
    { id: "q1_meme_zh", query: "大狗叫是什么梗" },
    { id: "q2_tech_en", query: "OpenCode open source AI coding agent" },
    { id: "q3_coding", query: "React useEffect cleanup function when to return" },
    { id: "q4_news", query: "OpenAI GPT-5 release date news" },
    { id: "q5_zh_tech", query: "pnpm workspace 和 npm workspaces 区别" },
    { id: "q6_slang", query: "yolo mode coding agent 是什么意思" },
    { id: "q7_npm", query: "zod v4 release notes breaking changes" },
  ],
};

const t = new InternetSearchTool();
const lines = [];
for (const q of suite.queries) {
  process.stderr.write(`bench ${q.id}…\n`);
  const started = Date.now();
  try {
    const r = await t.execute(
      { query: q.query, max_results: 8, time: "y" },
      { sessionId: "search-bench", projectRoot: root },
    );
    lines.push(
      JSON.stringify({
        id: q.id,
        query: q.query,
        ok: r.ok,
        ms: Date.now() - started,
        sources: r.payload?.sources,
        engine_notices: r.payload?.engine_notices,
        count: r.payload?.count,
        top: (r.payload?.results || []).slice(0, 5).map((x) => ({
          title: x.title,
          url: x.url,
          definition: x.definition,
          snippet: x.snippet,
          source: x.source,
          score: x.score,
        })),
      }),
    );
  } catch (e) {
    lines.push(JSON.stringify({ id: q.id, query: q.query, error: String(e) }));
  }
}

const out = resolve(outDir, "search_bench_maou.jsonl");
writeFileSync(out, lines.join("\n") + "\n");
console.log("wrote", out, "exists", existsSync(out));
