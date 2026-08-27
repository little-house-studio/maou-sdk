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
  readToolIntent,
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
  it("readToolIntent pulls description from params or JSON", () => {
    assert.equal(readToolIntent({ description: "读剪贴板" }), "读剪贴板");
    assert.equal(
      readToolIntent(JSON.stringify({ description: "列窗口" })),
      "列窗口",
    );
    assert.equal(readToolIntent({ command: "ls" }), "");
  });

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
    assert.doesNotMatch(toolTitleMeta(c), /字|tok/);
    assert.equal(toolFoldMark(c, false), "▶");
    assert.equal(toolFoldMark(c, true), "▼");
  });

  it("resolveToolCard keeps call intent, not result first line", () => {
    const m: DraftMessage = {
      id: "t-res",
      role: "tool",
      body: "=== 前台窗口标题 ===\nMaou",
      tool: {
        name: "use_terminal",
        result: "=== 前台窗口标题 ===\nMaou",
        done: true,
      },
    };
    assert.equal(resolveToolCard(m).description, "");
    const withIntent: DraftMessage = {
      ...m,
      tool: {
        ...m.tool!,
        description: "读前台窗口标题",
        durationMs: 1200,
      },
    };
    const c = resolveToolCard(withIntent);
    assert.equal(c.description, "读前台窗口标题");
    assert.equal(toolTitleMeta(c), "读前台窗口标题 1.2s");
    assert.equal(toolFoldMark({ ...c, isError: true }, false), "▶");
    assert.equal(toolFoldMark({ ...c, done: false }, false), "▶");
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
    assert.match(html, /wire-tool-led/);
    assert.match(html, /use_terminal/);
    assert.match(html, /wire-tool-intent/);
    assert.match(html, /rg agent-terminal in server/);
    assert.match(html, /wire-tool-dur/);
    assert.match(html, /420ms/);
    assert.match(html, /wire-tool-mark/);
    assert.match(html, />▶</);
    assert.doesNotMatch(html, /字|tok/);
    assert.doesNotMatch(html, /打开终端/);
    // collapsed by default — no expanded body sections until click
    assert.doesNotMatch(html, /▸ 输出/);
  });

  it("error tool cards stay collapsed", () => {
    const tool = FULL_CONTEXT_MESSAGES.find((m) => m.id === "fc-tool-run");
    assert.ok(tool?.tool?.isError);
    const html = renderToStaticMarkup(
      createElement(ToolCard, { message: tool! }),
    );
    assert.match(html, /is-error/);
    assert.match(html, /is-collapsed/);
    assert.match(html, /data-tool-led="err"/);
    assert.doesNotMatch(html, /▸ 输出/);
  });

  it("tool LED is ok when done, wait while running", () => {
    const base = {
      id: "t",
      role: "tool" as const,
      body: "out",
      tool: { name: "reader", result: "out", done: true, isError: false },
    };
    const done = renderToStaticMarkup(createElement(ToolCard, { message: base }));
    assert.match(done, /data-tool-led="ok"/);
    assert.match(done, /is-ok/);

    const wait = renderToStaticMarkup(
      createElement(ToolCard, {
        message: {
          ...base,
          tool: { name: "reader", result: "", done: false, isError: false },
        },
      }),
    );
    assert.match(wait, /data-tool-led="wait"/);
    assert.match(wait, /is-wait/);
  });
});
