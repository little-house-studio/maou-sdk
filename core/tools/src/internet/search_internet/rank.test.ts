import { describe, expect, it } from "vitest";
import {
  isAnswerBearingText,
  rankAndFilter,
  rescoreEnriched,
  scoreResult,
  tokenCoverage,
} from "./rank.js";
import type { SearchResult } from "./types.js";

const ctx = {
  query: "React useEffect cleanup function when to return",
  category: "general" as const,
  timeFilter: "y" as const,
  techIntent: true,
};

describe("tokenCoverage + entity disambiguation", () => {
  it("prefers useEffect docs over bare React homepage", () => {
    const home: SearchResult = {
      title: "React – A JavaScript library for building user interfaces",
      url: "https://react.dev/",
      snippet: "The library for web and native user interfaces",
      source: "bing",
      domain: "react.dev",
    };
    const docs: SearchResult = {
      title: "useEffect – React",
      url: "https://react.dev/reference/react/useEffect",
      snippet:
        "After every commit React will first run the cleanup function then setup. Cleanup runs on unmount.",
      source: "bing",
      domain: "react.dev",
    };
    expect(tokenCoverage(docs, ctx.query)).toBeGreaterThan(tokenCoverage(home, ctx.query));
    const ranked = rankAndFilter([home, docs], ctx, 5);
    expect(ranked[0].url).toContain("useEffect");
  });

  it("penalizes YOLO object-detection when query is coding-agent yolo mode", () => {
    const q = "yolo mode coding agent 是什么意思";
    const vision: SearchResult = {
      title: "Ultralytics YOLO 目标检测",
      url: "https://docs.ultralytics.com/",
      snippet: "YOLO object detection and segmentation",
      source: "bing",
      domain: "docs.ultralytics.com",
    };
    const agent: SearchResult = {
      title: "Cursor YOLO Mode 完整指南",
      url: "https://www.cursor-ide.com/blog/cursor-yolo-mode-guide",
      snippet: "YOLO Mode 允许 Agent 自动执行终端命令，无需逐步人工确认",
      source: "bing",
      domain: "cursor-ide.com",
    };
    const ranked = rankAndFilter([vision, agent], {
      query: q,
      category: "general",
      timeFilter: "y",
      techIntent: true,
    }, 5);
    expect(ranked[0].domain).toBe("cursor-ide.com");
  });

  it("penalizes General Zod film vs zod schema v4", () => {
    const film: SearchResult = {
      title: "General Zod (1978 film series character)",
      url: "https://en.wikipedia.org/wiki/General_Zod",
      snippet: "supervillain appearing in American comic books",
      source: "bing",
      domain: "en.wikipedia.org",
    };
    const lib: SearchResult = {
      title: "Migration guide | Zod",
      url: "https://zod.dev/v4/changelog",
      snippet: "breaking changes in Zod 4; unified error parameter",
      source: "bing",
      domain: "zod.dev",
    };
    const ranked = rankAndFilter([film, lib], {
      query: "zod v4 release notes breaking changes",
      category: "coding",
      timeFilter: "y",
      techIntent: true,
    }, 5);
    expect(ranked[0].domain).toBe("zod.dev");
  });

  it("rescoreEnriched promotes definitional meme snippet", () => {
    const shell = {
      title: "大狗叫 hashtag",
      url: "https://www.douyin.com/hashtag/x",
      snippet: "短视频流",
      source: "bing",
      domain: "douyin.com",
    };
    const def = {
      title: "大狗叫是什么意思",
      url: "https://example.com/meme",
      snippet: "大狗叫是谐音戴口罩，叮咚鸡是听通知",
      definition: "大狗叫是谐音戴口罩，叮咚鸡是听通知",
      source: "bing",
      domain: "example.com",
      enriched: true,
      excerpts: ["大狗叫是谐音戴口罩，叮咚鸡是听通知"],
    };
    const ranked = rescoreEnriched([shell, def], {
      query: "大狗叫是什么梗",
      category: "general",
      timeFilter: "y",
      techIntent: false,
    }, 5);
    expect(ranked[0].url).toContain("example.com");
  });

  it("scoreResult is deterministic", () => {
    const r: SearchResult = {
      title: "test",
      url: "https://example.com/a",
      snippet: "hello",
      source: "bing",
      domain: "example.com",
    };
    expect(scoreResult(r, ctx).score).toBe(scoreResult(r, ctx).score);
  });

  it("isAnswerBearingText requires structured definition not keyword soup", () => {
    expect(isAnswerBearingText("大狗叫是什么谐音梗 大狗叫意思 大狗叫什么名字")).toBe(false);
    expect(
      isAnswerBearingText("大狗叫是谐音戴口罩，叮咚鸡是听通知的谐音"),
    ).toBe(true);
    expect(isAnswerBearingText("return a cleanup function from useEffect")).toBe(true);
  });
});
