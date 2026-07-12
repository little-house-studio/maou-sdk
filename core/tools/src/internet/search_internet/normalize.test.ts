import { describe, expect, it } from "vitest";
import {
  extractDateFromText,
  normalizeResult,
  normalizeUrl,
  resultKey,
} from "./normalize.js";
import { detectTechIntent, rankAndFilter } from "./rank.js";
import type { SearchResult } from "./types.js";

describe("normalizeUrl", () => {
  it("accepts normal https", () => {
    expect(normalizeUrl("https://github.com/anomalyco/opencode")).toBe(
      "https://github.com/anomalyco/opencode",
    );
  });

  it("rebuilds Bing cite display strings into real URLs", () => {
    expect(normalizeUrl("https://github.com › anomalyco › opencode")).toBe(
      "https://github.com/anomalyco/opencode",
    );
  });

  it("unwraps duckduckgo redirect", () => {
    const u = normalizeUrl(
      "https://duckduckgo.com/l/?uddg=" +
        encodeURIComponent("https://opencode.ai/docs") +
        "&rut=abc",
    );
    expect(u).toBe("https://opencode.ai/docs");
  });

  it("unwraps Bing ck/a base64 u= redirect", () => {
    const real = "https://opencode.ai/";
    const b64 = Buffer.from(real, "utf8").toString("base64");
    const u = normalizeUrl(
      `https://www.bing.com/ck/a?!&&p=abc&u=a1${b64}&ntb=1`.replace("&&", "&"),
    );
    expect(u).toBe("https://opencode.ai/");
  });

  it("drops unresolvable Bing tracking links", () => {
    expect(
      normalizeUrl("https://www.bing.com/ck/a?!&p=deadbeef&ntb=1"),
    ).toBeNull();
  });

  it("strips tracking params", () => {
    const u = normalizeUrl("https://example.com/a?utm_source=x&id=1");
    expect(u).toBe("https://example.com/a?id=1");
  });
});

describe("extractDateFromText", () => {
  it("parses ISO and relative", () => {
    expect(extractDateFromText("Published 2026-07-01 on blog")).toBe("2026-07-01");
    expect(extractDateFromText("2 days ago")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(extractDateFromText("3 天前")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("normalizeResult", () => {
  it("drops empty title / bad url", () => {
    expect(normalizeResult({ title: "", url: "https://a.com" }, "bing")).toBeNull();
    expect(normalizeResult({ title: "x", url: "not a url" }, "bing")).toBeNull();
  });

  it("keeps good rows", () => {
    const r = normalizeResult(
      {
        title: "OpenCode",
        url: "https://opencode.ai/",
        snippet: "The open source AI coding agent",
      },
      "ddgr",
    );
    expect(r?.domain).toBe("opencode.ai");
    expect(r?.source).toBe("ddgr");
  });
});

describe("rankAndFilter reliability", () => {
  it("ranks tech docs above shopping noise for tech queries", () => {
    const rows: SearchResult[] = [
      {
        title: "Best Buy Official Store",
        url: "https://www.bestbuy.com/",
        snippet: "Shop electronics",
        source: "bing",
        domain: "bestbuy.com",
      },
      {
        title: "OpenCode | open source AI coding agent",
        url: "https://opencode.ai/",
        snippet: "CLI coding agent 2026",
        source: "ddg-lite",
        domain: "opencode.ai",
        publishedAt: "2026-06-01",
      },
      {
        title: "anomalyco/opencode",
        url: "https://github.com/anomalyco/opencode",
        snippet: "⭐165000 open source coding agent",
        source: "github-api",
        domain: "github.com",
        publishedAt: "2026-07-01",
      },
    ];
    const ranked = rankAndFilter(
      rows,
      {
        query: "best open source CLI coding agents 2026",
        category: "coding",
        timeFilter: "y",
        techIntent: true,
      },
      10,
    );
    expect(ranked[0].domain).not.toBe("bestbuy.com");
    expect(ranked.some((r) => r.domain === "bestbuy.com")).toBe(false);
    expect(ranked[0].domain === "github.com" || ranked[0].domain === "opencode.ai").toBe(
      true,
    );
  });

  it("detectTechIntent", () => {
    expect(detectTechIntent("best open source coding agent", "general")).toBe(true);
    expect(detectTechIntent("best pizza near me", "general")).toBe(false);
  });

  it("resultKey dedups www", () => {
    const a = normalizeResult(
      { title: "Alpha", url: "https://www.example.com/x/", snippet: "" },
      "bing",
    )!;
    const b = normalizeResult(
      { title: "Beta", url: "https://example.com/x", snippet: "" },
      "ddgr",
    )!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(resultKey(a)).toBe(resultKey(b));
  });
});
