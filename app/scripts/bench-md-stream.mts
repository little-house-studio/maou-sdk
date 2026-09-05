/**
 * Micro-bench: cost of re-rendering the streaming assistant markdown.
 *
 * Compares, per frame while a reply streams:
 *   A) today (after frame batching): full DraftMarkdown parse+render of the whole body
 *   B) block-memo candidate: only the tail block (after the last blank line) re-renders
 *
 * renderToStaticMarkup ≈ parse + React element build; the browser adds
 * reconciliation on top, which scales the same way.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftMarkdown } from "../src/client/wire/DraftMarkdown";

function para(i: number) {
  return `第 ${i} 段说明：这里解释一下为什么 \`ChatPanel\` 会在每个 token 上重渲染，以及 **合批** 之后帧预算怎么分配。路径 src/client/ChatPanel.tsx 里有三处 setState 会互相放大。`;
}
function list(i: number) {
  return `- 要点 ${i}A：保持引用稳定\n- 要点 ${i}B：只重画变化的那一轮\n- 要点 ${i}C：轮询在后台停表`;
}
function code(i: number) {
  return "```ts\nexport function step" + i + "(lines: ChatLine[]) {\n  const next = [...lines];\n  for (let k = next.length - 1; k >= 0; k--) {\n    if (next[k]!.role === \"assistant\") return next;\n  }\n  return next;\n}\n```";
}
function table() {
  return "| 项目 | 之前 | 之后 |\n|---|---|---|\n| 每 token 渲染 | 2 次整面板 | 1 次/帧 |\n| 整壳重画 | 每 token | 仅摘要变化 |";
}

function body(targetBytes: number): string {
  const parts: string[] = [];
  let i = 0;
  let size = 0;
  while (size < targetBytes) {
    const block =
      i % 5 === 3 ? code(i) : i % 5 === 4 ? table() : i % 3 === 1 ? list(i) : para(i);
    parts.push(i % 4 === 0 ? `## 小节 ${i}\n\n${block}` : block);
    size += block.length + 2;
    i++;
  }
  return parts.join("\n\n");
}

function tailBlock(md: string): string {
  // Same rule the candidate would use: last blank line outside a code fence.
  const lines = md.split("\n");
  let inFence = false;
  let cut = 0;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k]!;
    if (/^\s{0,3}(```|~~~)/.test(l)) inFence = !inFence;
    if (!inFence && l.trim() === "" && k + 1 < lines.length && /^\S/.test(lines[k + 1]!)) {
      cut = k + 1;
    }
  }
  return lines.slice(cut).join("\n");
}

function bench(label: string, src: string, iters: number): number {
  // warm
  for (let k = 0; k < 3; k++) renderToStaticMarkup(createElement(DraftMarkdown, { source: src }));
  const t0 = performance.now();
  for (let k = 0; k < iters; k++) {
    renderToStaticMarkup(createElement(DraftMarkdown, { source: src + (k % 2 ? " " : "") }));
  }
  const ms = (performance.now() - t0) / iters;
  console.log(`${label.padEnd(34)} ${ms.toFixed(2)} ms/render`);
  return ms;
}

/**
 * C) the shipped path: <DraftMarkdown streaming> re-rendered with a growing
 * tail. renderToStaticMarkup cannot reuse memoized subtrees, so this measures
 * the split path's parse cost across ALL blocks — an upper bound. In the real
 * renderer only the tail block's MdBlock re-runs (≈ B).
 */
function benchStreaming(label: string, src: string, iters: number): number {
  for (let k = 0; k < 3; k++) {
    renderToStaticMarkup(createElement(DraftMarkdown, { source: src, streaming: true }));
  }
  const t0 = performance.now();
  for (let k = 0; k < iters; k++) {
    renderToStaticMarkup(
      createElement(DraftMarkdown, { source: src + (k % 2 ? " " : ""), streaming: true }),
    );
  }
  const ms = (performance.now() - t0) / iters;
  console.log(`${label.padEnd(34)} ${ms.toFixed(2)} ms/render`);
  return ms;
}

const FRAME_MS = 16.7;
for (const kb of [2, 8, 20, 40]) {
  const md = body(kb * 1024);
  const tail = tailBlock(md);
  console.log(`\n=== reply ≈ ${kb} KB (${md.length} chars, tail block ${tail.length} chars)`);
  const full = bench("A  full body per frame (before)", md, kb >= 20 ? 20 : 60);
  const part = bench("B  tail block only (ideal)", tail, 200);
  benchStreaming("C  <DraftMarkdown streaming> SSR upper bound", md, kb >= 20 ? 20 : 60);
  const budgetA = (full / FRAME_MS) * 100;
  const budgetB = (part / FRAME_MS) * 100;
  console.log(
    `   frame budget used: A ${budgetA.toFixed(0)}%  →  B ${budgetB.toFixed(0)}%   (${(full / Math.max(part, 0.01)).toFixed(0)}× less work)`,
  );
}
