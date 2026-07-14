import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearGalleryCatalogCache,
  loadGalleryWorks,
  resolveGalleryImagesPaths,
} from "./load-catalog.js";

describe("gallery-images.json catalog", () => {
  let cwd: string;

  beforeEach(() => {
    clearGalleryCatalogCache();
    cwd = mkdtempSync(join(tmpdir(), "maou-gallery-meta-"));
  });

  afterEach(() => {
    clearGalleryCatalogCache();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("包内默认 JSON 可读（至少 fallen-angel）", () => {
    const works = loadGalleryWorks(cwd);
    expect(works.length).toBeGreaterThanOrEqual(1);
    expect(works.some((w) => w.id === "fallen-angel")).toBe(true);
  });

  it("项目 .maou/gallery-images.json 可覆盖", () => {
    const dir = join(cwd, ".maou");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "gallery-images.json"),
      JSON.stringify({
        version: 1,
        works: [
          {
            id: "custom-only",
            titleZh: "自定义",
            titleEn: "Custom",
            artistZh: "测试",
            artistEn: "Test",
            year: "2026",
            enabled: true,
          },
          {
            id: "disabled-one",
            titleZh: "禁用",
            titleEn: "Off",
            artistZh: "x",
            artistEn: "x",
            year: "1",
            enabled: false,
          },
        ],
      }),
      "utf-8",
    );
    clearGalleryCatalogCache();
    const works = loadGalleryWorks(cwd);
    expect(works.map((w) => w.id)).toEqual(["custom-only"]);
    expect(works[0]!.titleZh).toBe("自定义");
  });

  it("resolveGalleryImagesPaths 标出 active", () => {
    const paths = resolveGalleryImagesPaths(cwd);
    expect(paths.project).toContain("gallery-images.json");
    // 无项目覆盖时 active 应为 package 或 null（取决于 assets 是否在路径上）
    if (existsSync(paths.package)) {
      expect(paths.active).toBe(paths.package);
    }
  });
});
