/**
 * Block-split rendering must be pixel-identical to whole-document rendering.
 * We prove it at the HTML level: renderToStaticMarkup(streaming) ===
 * renderToStaticMarkup(whole) for real docs, synthetic edge cases, and every
 * streaming prefix of them (unclosed fences, half tables, dangling lists…).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftMarkdown } from "./DraftMarkdown";
import { markdownSplitUnsafe, splitMarkdownBlocks } from "./markdown-blocks";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, "../../../docs");

function whole(md: string): string {
  return renderToStaticMarkup(createElement(DraftMarkdown, { source: md }));
}
function chunked(md: string): string {
  return renderToStaticMarkup(
    createElement(DraftMarkdown, { source: md, streaming: true }),
  );
}

/** Cut points that land mid-line, mid-fence, mid-table — like a real stream. */
function prefixes(md: string, steps = 48): string[] {
  const out: string[] = [];
  for (let k = 1; k <= steps; k++) {
    const cut = Math.floor((md.length * k) / steps);
    out.push(md.slice(0, cut));
  }
  // Also cut exactly on blank lines and right after them.
  let idx = md.indexOf("\n\n");
  while (idx >= 0 && out.length < steps + 40) {
    out.push(md.slice(0, idx + 1), md.slice(0, idx + 2));
    idx = md.indexOf("\n\n", idx + 2);
  }
  return out;
}

const SYNTHETIC: Record<string, string> = {
  nestedListContinuation: [
    "- item one",
    "",
    "  continued paragraph inside item one",
    "",
    "  - nested a",
    "  - nested b",
    "",
    "para after list",
    "",
    "1. first",
    "2. second",
    "",
    "   indented note under second",
    "",
    "tail",
  ].join("\n"),
  fences: [
    "intro",
    "",
    "```ts",
    "const a = 1;",
    "",
    "const b = 2;",
    "```",
    "",
    "~~~",
    "tilde fence",
    "",
    "still inside",
    "~~~",
    "",
    "````md",
    "```",
    "nested backticks inside a longer fence",
    "```",
    "````",
    "",
    "outro",
    "",
    "```js",
    "unclosed fence runs to the end",
    "",
    "even across blank lines",
  ].join("\n"),
  quotesTablesHeadings: [
    "# Title",
    "",
    "Setext",
    "===",
    "",
    "> quoted",
    "lazy continuation",
    "",
    "> second quote",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "para **bold** _em_ `code` [link](https://example.com) ~~del~~",
    "",
    "---",
    "",
    "- [ ] todo",
    "- [x] done",
    "",
    "    indented code",
    "",
    "    more indented code",
    "",
    "###### h6",
    "",
    "<div>",
    "html block kind 6",
    "",
    "after html",
  ].join("\n"),
  crlfAndBlankRuns: "a\r\n\r\n\r\nb\r\n\r\n- x\r\n\r\n- y\r\n\r\n\r\nend\r\n\r\n",
  looseLists: [
    "- a",
    "",
    "-", // empty item mid-stream keeps the list loose
    "",
    "- c",
    "lazy continuation line",
    "",
    "- d",
    "",
    "## heading then list",
    "- e",
    "",
    "- ",
    "",
    "1) one",
    "",
    "2) two",
    "",
    "para",
    "",
    "- fresh list after a paragraph",
    "- second",
    "",
    "* other bullet char",
    "",
    "+ and another",
    "",
    "end",
  ].join("\n"),
};

const DOCS = ["md-kitchen-sink.md", "webui-md-smoke.md", "sample-prd.md"].map(
  (name) => ({ name, md: readFileSync(join(docsDir, name), "utf8") }),
);

describe("splitMarkdownBlocks", () => {
  it("splits at safe blank lines only", () => {
    const blocks = splitMarkdownBlocks(SYNTHETIC.fences!);
    assert.ok(blocks && blocks.length >= 4, "fence doc should split");
    // No block boundary inside a fence: every fenced block keeps its content
    for (const b of blocks!) {
      const opens = (b.match(/^\s*```/gm) ?? []).length;
      if (opens === 1) {
        assert.ok(
          /unclosed fence/.test(b),
          `only the unclosed tail fence may have a single fence line: ${b}`,
        );
      }
    }
    const nested = splitMarkdownBlocks(SYNTHETIC.nestedListContinuation!);
    assert.ok(nested);
    assert.match(nested![0]!, /continued paragraph inside item one/);
    assert.match(nested![0]!, /nested b/);
    assert.equal(nested![1], "para after list");
  });

  it("returns null when a construct spans blocks", () => {
    assert.equal(splitMarkdownBlocks("see [x]\n\n[x]: https://a.b"), null);
    assert.equal(splitMarkdownBlocks("note[^1]\n\n[^1]: footnote"), null);
    assert.equal(splitMarkdownBlocks("<!-- c\n\n-->\n\np"), null);
    assert.equal(splitMarkdownBlocks("<script>\n\n</script>\n\np"), null);
    assert.equal(splitMarkdownBlocks("<pre>\n\n</pre>\n\np"), null);
    assert.equal(markdownSplitUnsafe("inline <!-- not at line start --> ok"), false);
    assert.equal(splitMarkdownBlocks("single block only"), null);
    assert.equal(splitMarkdownBlocks(""), null);
  });

  it("keeps earlier blocks byte-identical as the stream grows", () => {
    for (const { md } of DOCS) {
      let prev: string[] | null = null;
      for (const p of prefixes(md, 32)) {
        const cur = splitMarkdownBlocks(p);
        if (prev && cur) {
          const stable = prev.slice(0, -1);
          assert.deepEqual(
            cur.slice(0, stable.length),
            stable,
            "all but the last block of the shorter prefix must be reused",
          );
        }
        prev = cur;
      }
    }
  });
});

describe("DraftMarkdown streaming render equals whole render", () => {
  for (const { name, md } of DOCS) {
    it(`docs/${name} (full + streaming prefixes)`, () => {
      assert.ok(splitMarkdownBlocks(md), `${name} must actually split`);
      assert.equal(chunked(md), whole(md));
      for (const p of prefixes(md)) {
        assert.equal(chunked(p), whole(p), `prefix len ${p.length}`);
      }
    });
  }

  for (const [name, md] of Object.entries(SYNTHETIC)) {
    it(`synthetic ${name} (full + streaming prefixes)`, () => {
      assert.equal(chunked(md), whole(md));
      for (const p of prefixes(md, 64)) {
        assert.equal(chunked(p), whole(p), `prefix len ${p.length}`);
      }
    });
  }

  it("keeps the dm-* class names and engine marker", () => {
    const html = chunked(SYNTHETIC.quotesTablesHeadings!);
    assert.match(html, /data-md-engine="react-markdown"/);
    assert.match(html, /class="dm-p"/);
    assert.match(html, /class="dm-table"/);
    assert.match(html, /dm-task-list/);
  });
});
