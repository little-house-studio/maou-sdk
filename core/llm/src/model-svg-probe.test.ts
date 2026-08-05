import { describe, it, expect } from "vitest";
import {
  buildModelSvgProbePrompt,
  extractSvgFromModelText,
  sanitizeSvg,
  svgToImageDataUrl,
} from "./model-svg-probe.js";

describe("model-svg-probe extract", () => {
  it("builds prompt with subject", () => {
    const p = buildModelSvgProbePrompt("红色小猫");
    expect(p).toContain("红色小猫");
    expect(p).toContain("<svg>");
  });

  it("extracts bare svg", () => {
    const svg = extractSvgFromModelText(
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("xmlns=");
  });

  it("extracts fenced svg", () => {
    const svg = extractSvgFromModelText(
      '好的：\n```svg\n<svg width="10" height="10"><rect width="10" height="10"/></svg>\n```\n',
    );
    expect(svg).toMatch(/<svg[\s\S]*<\/svg>/);
  });

  it("returns null without svg", () => {
    expect(extractSvgFromModelText("我不会画")).toBeNull();
  });

  it("strips script from svg", () => {
    const s = sanitizeSvg(
      '<svg><script>alert(1)</script><circle r="1"/></svg>',
    );
    expect(s).not.toContain("script");
    expect(s).toContain("circle");
  });

  it("svgToImageDataUrl is usable data url", () => {
    const u = svgToImageDataUrl(
      '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
    );
    expect(u.startsWith("data:image/svg+xml")).toBe(true);
  });
});
