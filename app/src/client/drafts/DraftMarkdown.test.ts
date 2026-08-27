/**
 * Drive shipped DraftMarkdown on the real showcase assistant body.
 * Run: tsx --test src/client/drafts/DraftMarkdown.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DraftMarkdown } from "./DraftMarkdown";
import {
  FULL_CONTEXT_MESSAGES,
  messagesForSession,
  getScenario,
} from "./fixtures";

function renderMd(source: string): string {
  return renderToStaticMarkup(
    createElement(DraftMarkdown, { source }),
  );
}

describe("DraftMarkdown on showcase inventory", () => {
  it("renders ul.dm-list and ol.dm-list from fc-a1 pure list blocks", () => {
    const a1 = FULL_CONTEXT_MESSAGES.find((m) => m.id === "fc-a1");
    assert.ok(a1, "fc-a1 present in FULL_CONTEXT_MESSAGES");
    const html = renderMd(a1!.body);
    assert.match(html, /class="dm-list"/);
    assert.match(html, /<ul class="dm-list">/);
    assert.match(html, /<ol class="dm-list">/);
    assert.match(html, /<strong>/);
    assert.match(html, /class="dm-code"/);
    assert.match(html, /class="dm-pre/);
    assert.match(html, /class="dm-link"/);
    assert.match(html, /href="https:\/\/example\.com"/);
  });

  it("renders list markup for hydrated normal primary assistant body", () => {
    const s = getScenario("normal");
    const msgs = messagesForSession(s.messagesBySession, s.initialSessionId);
    const a1 = msgs.find((m) => m.id.endsWith("fc-a1") && m.role === "assistant");
    assert.ok(a1, "hydrated primary session has fc-a1");
    const html = renderMd(a1!.body);
    assert.match(html, /<ul class="dm-list">/);
    assert.match(html, /<ol class="dm-list">/);
    assert.match(html, /<strong>/);
    assert.match(html, /class="dm-code"/);
    assert.match(html, /class="dm-pre/);
    assert.match(html, /class="dm-link"/);
  });

  it("isolated pure list paragraphs become lists (GFM)", () => {
    const ul = renderMd("- a\n- b");
    assert.match(ul, /<ul class="dm-list">/);
    const ol = renderMd("1. a\n2. b");
    assert.match(ol, /<ol class="dm-list">/);
    // GFM treats glued label + list as paragraph + list (mature parser, not the old homegrown rule)
    const glued = renderMd("无序列表：\n- a\n- b");
    assert.match(glued, /class="dm-list"/);
  });

  it("uses react-markdown engine", () => {
    const html = renderMd("hello **x**");
    assert.match(html, /data-md-engine="react-markdown"/);
    assert.match(html, /<strong>x<\/strong>/);
  });

  it("renders ATX headings as h1–h6 for project outline jump targets", () => {
    const html = renderMd("# Root\n\n## Child\n\nbody text\n\n### Deep\n");
    assert.match(html, /<h1 class="dm-h dm-h1"[^>]*>Root<\/h1>/);
    assert.match(html, /<h2 class="dm-h dm-h2"[^>]*>Child<\/h2>/);
    assert.match(html, /<h3 class="dm-h dm-h3"[^>]*>Deep<\/h3>/);
    assert.match(html, /body text/);
    // inline markup inside headings
    const bold = renderMd("## Hello **world**\n");
    assert.match(bold, /<h2 class="dm-h dm-h2"/);
    assert.match(bold, /<strong>world<\/strong>/);
  });

  it("renders GFM-ish tables, blockquotes, and hr", () => {
    const table = renderMd(
      "| 包 | 职责 |\n|----|------|\n| cli | TUI |\n| app | 草稿 |\n",
    );
    assert.match(table, /class="dm-table"/);
    assert.match(table, /<th[^>]*>包<\/th>/);
    assert.match(table, /<td[^>]*>cli<\/td>/);
    assert.match(table, /TUI/);

    const quote = renderMd("> note **x**\n> line2\n");
    assert.match(quote, /class="dm-quote"/);
    assert.match(quote, /<strong>x<\/strong>/);

    const hr = renderMd("before\n\n---\n\nafter\n");
    assert.match(hr, /class="dm-hr"/);
  });

  it("marks headings clickable when onHeadingClick is provided", () => {
    const html = renderToStaticMarkup(
      createElement(DraftMarkdown, {
        source: "# Go\n",
        onHeadingClick: () => {},
      }),
    );
    assert.match(html, /is-clickable/);
    assert.match(html, /data-heading-title="Go"/);
  });

  it("renders task lists and strikethrough", () => {
    const html = renderMd("- [ ] todo\n- [x] done\n\n~~old~~ new\n");
    assert.match(html, /dm-task-list/);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /todo/);
    assert.match(html, /is-checked/);
    assert.match(html, /class="dm-del"/);
    assert.match(html, /old/);
  });
});
