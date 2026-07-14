/**
 * 古典画廊 catalog —— 元数据来自 assets/gallery-images.json（可自定义）。
 * ASCII 正文预烘焙在 works/<id>/{sm,md,lg}.txt。
 */

import type { GallerySize, GalleryWork } from "./catalog-types.js";
import { loadGalleryWorks } from "./load-catalog.js";

export type { GallerySize, GalleryWork } from "./catalog-types.js";

/**
 * 策展清单：运行时从 JSON 加载。
 * - 包内默认：cli/assets/gallery-images.json
 * - 用户覆盖：~/.maou/gallery-images.json
 * - 项目覆盖：<cwd>/.maou/gallery-images.json
 */
export function getGalleryWorks(): GalleryWork[] {
  return loadGalleryWorks();
}

/** @deprecated 用 getGalleryWorks()；保留别名兼容旧 import */
export const GALLERY_WORKS: GalleryWork[] = new Proxy([] as GalleryWork[], {
  get(_t, prop, receiver) {
    const list = loadGalleryWorks();
    if (prop === "length") return list.length;
    if (prop === Symbol.iterator) return list[Symbol.iterator].bind(list);
    if (typeof prop === "string" && /^\d+$/.test(prop)) {
      return list[Number(prop)];
    }
    const v = Reflect.get(list, prop, receiver);
    return typeof v === "function" ? v.bind(list) : v;
  },
});

/**
 * 终端档位（按「可挂画高度」选，不是按整屏 rows 硬阈值）：
 *   对话区 rows 还要扣掉 logo + 铭牌 + 呼吸缝 ≈ 10 行，
 *   剩余才是画框预算。
 *
 *   sm 画约 17 行 / md 约 24 / lg 约 32（细线框，无 █ 外框）
 */
export const GALLERY_LAYOUT_OVERHEAD = 10; // logo + 缝 + 铭牌 + size 行
export const GALLERY_ART_ROWS: Record<GallerySize, number> = {
  sm: 17,
  md: 24,
  lg: 32,
};

export function pickGallerySize(cols: number, rows: number): GallerySize {
  const artBudget = Math.max(0, rows - GALLERY_LAYOUT_OVERHEAD);
  if (cols >= 140 && artBudget >= GALLERY_ART_ROWS.lg) return "lg";
  if (cols >= 80 && artBudget >= GALLERY_ART_ROWS.md) return "md";
  return "sm";
}

/** 若实测画高 + 开销仍溢出，降一档（lg→md→sm） */
export function fitGallerySize(
  size: GallerySize,
  artRows: number,
  contentRows: number,
  overhead: number = GALLERY_LAYOUT_OVERHEAD,
): GallerySize {
  const order: GallerySize[] = ["lg", "md", "sm"];
  let idx = order.indexOf(size);
  if (idx < 0) idx = 2;
  while (idx < order.length - 1 && artRows + overhead > contentRows) {
    idx += 1;
    artRows = GALLERY_ART_ROWS[order[idx]!];
  }
  return order[idx]!;
}

/** 按会话种子稳定随机；同 session 同一张，新会话换一张 */
export function pickGalleryWork(seed?: string): GalleryWork {
  const list = loadGalleryWorks();
  if (list.length === 0) {
    throw new Error("画廊 works 为空：请检查 assets/gallery-images.json");
  }
  if (!seed) {
    return list[Math.floor(Math.random() * list.length)]!;
  }
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return list[h % list.length]!;
}

export function formatPlaque(work: GalleryWork): string[] {
  const line1 = `《${work.titleZh}》  ${work.titleEn}`;
  const line2 = `${work.artistZh}  (${work.artistEn})  ·  ${work.year}`;
  const line3 = work.note ? work.note : "";
  return line3 ? [line1, line2, line3] : [line1, line2];
}
