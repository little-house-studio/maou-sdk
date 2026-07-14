import { describe, it, expect, beforeEach } from "vitest";
import {
  clearThemeCache,
  loadThemeById,
  getDefaultNavConfig,
  getDefaultThemeTokens,
  resolveHoverColor,
  lightenHex,
  splitColorValue,
  packageThemesDir,
  listThemeIds,
  resolveThemeArg,
  setActiveTheme,
} from "./load-theme.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("themes/<name>.json", () => {
  beforeEach(() => {
    clearThemeCache();
  });

  it("包内 themes 目录存在 tau-ceti", () => {
    const dir = packageThemesDir();
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "tau-ceti.json"))).toBe(true);
    expect(listThemeIds()).toContain("tau-ceti");
  });

  it("loadThemeById 加载 tokens + nav", () => {
    const t = loadThemeById("tau-ceti");
    expect(t).not.toBeNull();
    expect(t!.tokens.bg).toMatch(/^#/);
    expect(t!.tokens.accent).toMatch(/^#/i);
    expect(t!.nav.order[0]).toBe("agent");
  });

  it("未写 bgHover 的 nav 项自动生成 hover", () => {
    const nav = getDefaultNavConfig();
    // terminal 仅写了 bg，hover 应被解析
    expect(nav.items.terminal?.bgHover).toBeTruthy();
    expect(nav.items.terminal!.bgHover.toUpperCase()).not.toBe(
      nav.items.terminal!.bg.toUpperCase(),
    );
  });

  it("resolveHoverColor：显式优先，否则 lighten", () => {
    expect(resolveHoverColor("#808080", "#AABBCC")).toBe("#AABBCC");
    const auto = resolveHoverColor("#808080", undefined, {
      mode: "lighten",
      amount: 0.14,
      fallback: "#404040",
    });
    expect(auto).toMatch(/^#/);
    expect(auto.toUpperCase()).not.toBe("#808080");
  });

  it("splitColorValue 支持 string 与 {base,hover}", () => {
    expect(splitColorValue("#FF0000")).toEqual({ base: "#FF0000" });
    expect(splitColorValue({ base: "#00FF00", hover: "#11FF11" })).toEqual({
      base: "#00FF00",
      hover: "#11FF11",
    });
  });

  it("lightenHex 提亮", () => {
    const h = lightenHex("#000000", 0.5);
    expect(h).toBe("#808080");
  });

  it("resolveThemeArg 按名加载", () => {
    const t = resolveThemeArg("tau-ceti");
    setActiveTheme(t);
    expect(getDefaultThemeTokens().accent).toBeTruthy();
    expect(t.id).toBe("tau-ceti");
  });

  it("Nav 配色：agent 橙红 · 会话米黄 · 设置黄绿", () => {
    setActiveTheme(loadThemeById("tau-ceti")!);
    const nav = getDefaultNavConfig();
    expect(nav.items.agent?.bg.toUpperCase()).toBe("#FF741D");
    expect(nav.items.sessions?.bg.toUpperCase()).toBe("#F5F0D8");
    expect(nav.items.settings?.bg.toUpperCase()).toBe("#C7FF20");
  });
});
