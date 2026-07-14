import { describe, it, expect, afterEach } from "vitest";
import {
  wrapClickableLink,
  clickableUri,
  osc8PointerLinksEnabled,
  makeClickableTransform,
} from "./osc8-link.js";
import stringWidth from "string-width";

describe("osc8-link", () => {
  const prevLinks = process.env.MAOU_POINTER_LINKS;
  const prevPtr = process.env.MAOU_POINTER;

  afterEach(() => {
    if (prevLinks === undefined) delete process.env.MAOU_POINTER_LINKS;
    else process.env.MAOU_POINTER_LINKS = prevLinks;
    if (prevPtr === undefined) delete process.env.MAOU_POINTER;
    else process.env.MAOU_POINTER = prevPtr;
  });

  it("wrap 注入 OSC 8 且不改变视觉宽度", () => {
    delete process.env.MAOU_POINTER_LINKS;
    delete process.env.MAOU_POINTER;
    const plain = "  设置  ";
    const wrapped = wrapClickableLink(plain, "nav/settings");
    expect(wrapped).toContain("\x1b]8;;");
    expect(wrapped).toContain("https://maou.invalid/click/");
    expect(wrapped.endsWith("\x1b]8;;\x1b\\") || wrapped.includes("\x1b]8;;\x1b\\")).toBe(true);
    expect(stringWidth(wrapped)).toBe(stringWidth(plain));
  });

  it("MAOU_POINTER_LINKS=0 时不包", () => {
    process.env.MAOU_POINTER_LINKS = "0";
    expect(osc8PointerLinksEnabled()).toBe(false);
    expect(wrapClickableLink("设置", "nav/settings")).toBe("设置");
  });

  it("不重复嵌套", () => {
    delete process.env.MAOU_POINTER_LINKS;
    const once = wrapClickableLink("x", "a");
    const twice = wrapClickableLink(once, "b");
    expect(twice).toBe(once);
  });

  it("clickableUri 编码 id", () => {
    expect(clickableUri("nav/设置")).toMatch(/^https:\/\/maou\.invalid\/click\//);
  });

  it("makeClickableTransform 可复用", () => {
    delete process.env.MAOU_POINTER_LINKS;
    const t = makeClickableTransform("nav/agent");
    expect(t("agent")).toContain("nav%2Fagent");
  });
});
