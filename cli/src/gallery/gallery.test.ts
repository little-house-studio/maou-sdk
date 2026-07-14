import { describe, it, expect } from "vitest";
import {
  pickGallerySize,
  pickGalleryWork,
  formatPlaque,
  fitGallerySize,
  GALLERY_ART_ROWS,
  GALLERY_LAYOUT_OVERHEAD,
  GALLERY_WORKS,
} from "./catalog.js";
import {
  loadFramedArt,
  centerBlock,
  galleryDisplayWidth,
  galleryVerticalPads,
} from "./load-art.js";
import { maouLogoLines } from "./maou-logo.js";

describe("gallery", () => {
  it("三档尺寸断点（按画高预算，含 logo/铭牌开销）", () => {
    // 矮窗：装不下 md → sm
    expect(pickGallerySize(100, 28)).toBe("sm");
    // 中窗：rows - overhead ≥ 28 → md
    expect(pickGallerySize(100, 40)).toBe("md");
    // 宽+高：lg
    expect(pickGallerySize(160, 50)).toBe("lg");
    // 宽但矮：仍 sm
    expect(pickGallerySize(160, 30)).toBe("sm");
  });

  it("fitGallerySize 溢出时降档", () => {
    expect(fitGallerySize("lg", 36, 30)).toBe("sm");
    expect(fitGallerySize("md", 28, 40)).toBe("md");
    expect(fitGallerySize("lg", 36, 50)).toBe("lg");
  });

  it("同 seed 稳定选画", () => {
    const a = pickGalleryWork("session-abc");
    const b = pickGalleryWork("session-abc");
    expect(a.id).toBe(b.id);
  });

  it("fallen-angel 三档 ASCII 已烘焙且等宽", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const lines = loadFramedArt("fallen-angel", size);
      expect(lines).not.toBeNull();
      const w = lines![0]!.length;
      expect(lines!.every((l) => l.length === w)).toBe(true);
      expect(lines!.length).toBeGreaterThan(10);
      // 标称高度与烘焙一致（选档依赖；仅 fallen-angel 作基准）
      expect(lines!.length).toBe(GALLERY_ART_ROWS[size]);
    }
  });

  it("仅两幅自有馆藏均已烘焙三档", () => {
    const ids = ["fallen-angel", "dante-virgil"];
    for (const id of ids) {
      for (const size of ["sm", "md", "lg"] as const) {
        const lines = loadFramedArt(id, size);
        expect(lines, `${id}/${size}`).not.toBeNull();
        expect(lines!.length).toBeGreaterThan(8);
        const w = lines![0]!.length;
        expect(lines!.every((l) => l.length === w)).toBe(true);
        expect(lines![0]!.trimStart()[0]).toBe("┌");
      }
    }
  });

  it("catalog 仅 fallen-angel + dante-virgil", () => {
    const works = GALLERY_WORKS;
    expect(works.map((w) => w.id).sort()).toEqual(
      ["dante-virgil", "fallen-angel"].sort(),
    );
  });

  it("居中不截断画框（宽屏）", () => {
    const lines = loadFramedArt("fallen-angel", "sm")!;
    const centered = centerBlock(lines, 120);
    expect(centered[0]!.startsWith(" ")).toBe(true);
    // 外框现为细线 ┌─┐│└┘（实心 █ 留给 logo）
    const edge = centered[0]!.trimStart()[0];
    expect(edge === "┌" || edge === "╔").toBe(true);
    // █ 必须按显示宽 1 计，否则无法居中
    expect(galleryDisplayWidth("█".repeat(10))).toBe(10);
    // 左右 pad 对称（差最多 1）
    const maxW = galleryDisplayWidth(lines[0]!);
    const left = centered[0]!.length - lines[0]!.length;
    expect(left).toBe(Math.floor((120 - maxW) / 2));
  });

  it("垂直光学留白：下方略多于上方", () => {
    const { top, bottom } = galleryVerticalPads(40, 20);
    expect(top + bottom).toBe(20);
    expect(bottom).toBeGreaterThan(top);
    // free=20 → top≈36% floor=7, bottom=13
    expect(top).toBeGreaterThanOrEqual(6);
    expect(top).toBeLessThanOrEqual(8);
  });

  it("画作起点固定下移 2 格（top+2 后 bottom 相应减）", () => {
    const pads = galleryVerticalPads(40, 20);
    const free = pads.top + pads.bottom;
    const top = Math.min(free, pads.top + 2);
    const bottom = free - top;
    expect(top).toBe(pads.top + 2);
    expect(top + bottom).toBe(free);
    expect(bottom).toBe(pads.bottom - 2);
  });

  it("垂直留白边界：少行时光学沉底", () => {
    expect(galleryVerticalPads(20, 20)).toEqual({ top: 0, bottom: 0 });
    expect(galleryVerticalPads(21, 20)).toEqual({ top: 0, bottom: 1 });
    expect(galleryVerticalPads(22, 20)).toEqual({ top: 0, bottom: 2 });
    expect(galleryVerticalPads(23, 20)).toEqual({ top: 1, bottom: 2 });
    // free=4 → 上 1 下 3（不是 2/2）
    expect(galleryVerticalPads(24, 20)).toEqual({ top: 1, bottom: 3 });
  });

  it("典型终端：紧凑后有光学 free 行", () => {
    // 模拟 120×40 终端：chrome≈10，galleryRows≈29
    // 全量 logo(5)+画(19)+铭牌(5)=29 → free0；紧凑 logo3+画19+铭牌3=25 → free4
    const rows = 29;
    expect(pickGallerySize(118, rows)).toBe("sm");
    const art = loadFramedArt("fallen-angel", "sm")!;
    const logoH = 3; // compact logo
    const plaqueH = 1 + 2; // gap + 标题/作者
    const hangH = art.length + plaqueH;
    const hangArea = rows - logoH;
    const pads = galleryVerticalPads(hangArea, hangH);
    expect(pads.top + pads.bottom).toBe(hangArea - hangH);
    expect(pads.top + pads.bottom).toBeGreaterThanOrEqual(2);
    expect(pads.bottom).toBeGreaterThanOrEqual(pads.top);
    expect(GALLERY_LAYOUT_OVERHEAD).toBeGreaterThanOrEqual(8);
  });

  it("铭牌含标题作者年代（来自 assets JSON）", () => {
    const work = GALLERY_WORKS.find((w) => w.id === "fallen-angel")!;
    expect(work).toBeTruthy();
    const pl = formatPlaque(work!);
    expect(pl[0]).toContain("堕落天使");
    expect(pl.join(" ")).toContain("卡巴内尔");
    expect(pl.join(" ")).toContain("1847");
  });

  it("MAOU logo 固定样式（位图 + 标题贴顶 + 隔一行版本）", () => {
    const a = maouLogoLines(20);
    const b = maouLogoLines(200);
    expect(a).toEqual(b);
    expect(a.length).toBe(5);
    // 顶行：方印 + MAOU-AGENT（不隔行）
    expect(a[0]!.startsWith("█".repeat(14))).toBe(true);
    expect(a[0]).toContain("MAOU-AGENT");
    // 第二行：仅方印（隔一行）
    expect(a[1]).toBe("██  ██████  ██");
    expect(a[1]).not.toContain("MAOU");
    // 第三行：方印 + v <package.json version>
    expect(a[2]!.startsWith("████  ██  ████")).toBe(true);
    expect(a[2]).toMatch(/v\s*\S+/);
    // 与 package.json 一致（当前 0.1a）
    expect(a[2]).toContain("0.1a");
  });
});
