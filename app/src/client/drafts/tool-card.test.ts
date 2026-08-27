/**
 * CLI tool-card pure helpers + resolveToolCard from draft messages.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactCount,
  durationStr,
  isDiffResult,
  isWriteTool,
  resolveToolCard,
  slicePreview,
  toolFoldMark,
  toolResultSizeLabel,
  toolTitleMeta,
} from "./tool-card";
import type { DraftMessage } from "./types";
import { createElement } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolCard } from "./panels/ToolCard";
import { FULL_CONTEXT_MESSAGES } from "./fixtures";

describe("tool-card CLI helpers", () => {
  it("compactCount and durationStr match CLI-ish formats", () => {
    assert.equal(compactCount(200), "200");
    assert.equal(compactCount(2000), "2.0k");
    assert.equal(durationStr(undefined), "");
    assert.equal(durationStr(350), "350ms");
    assert.match(durationStr(1200), /1\.2s/);
  });

  it("toolResultSizeLabel reports chars and tok", () => {
    const label = toolResultSizeLabel("hello world");
    assert.match(label, /字/);
    assert.match(label, /tok/);
  });

  it("isDiffResult and isWriteTool classify like CLI", () => {
    assert.equal(isWriteTool("edit"), true);
    assert.equal(isWriteTool("read_file"), false);
    assert.equal(isDiffResult("--- a\n+++ b\n@@\n+line"), true);
    assert.equal(isDiffResult("plain output"), false);
  });

  it("resolveToolCard prefers structured tool meta", () => {
    const m: DraftMessage = {
      id: "t1",
      role: "tool",
      tag: "use_terminal",
      body: "fallback body",
      tool: {
        name: "use_terminal",
        description: "scan routes",
        args: JSON.stringify({ description: "scan routes", command: "rg" }),
        result: "ok\nline2",
        done: true,
        durationMs: 42,
      },
    };
    const c = resolveToolCard(m);
    assert.equal(c.name, "use_terminal");
    assert.equal(c.description, "scan routes");
    assert.equal(c.result, "ok\nline2");
    assert.equal(c.done, true);
    assert.match(toolTitleMeta(c), /scan routes/);
    assert.match(toolTitleMeta(c), /42ms/);
    assert.equal(toolFoldMark(c, false), "▶");
    assert.equal(toolFoldMark(c, true), "▼");
  });

  it("slicePreview folds long dumps at CLI preview counts", () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const folded = slicePreview(long, "read_file", false);
    assert.equal(folded.needFold, true);
    assert.equal(folded.totalLines, 40);
    assert.equal(folded.show.split("\n").length, 12);
    const full = slicePreview(long, "read_file", true);
    assert.equal(full.show.split("\n").length, 40);
  });

  it("ToolCard renders CLI title chip from showcase messages", () => {
    const tool = FULL_CONTEXT_MESSAGES.find((m) => m.id === "fc-tool-term");
    assert.ok(tool);
    const html = renderToStaticMarkup(
      createElement(ToolCard, { message: tool! }),
    );
    assert.match(html, /wire-tool-card/);
    assert.match(html, /wire-tool-name/);
    assert.match(html, /use_terminal/);
    assert.match(html, /wire-tool-mark/);
    // collapsed by default — no expanded body sections until click
    assert.doesNotMatch(html, /▸ 输出/);
  });
});
