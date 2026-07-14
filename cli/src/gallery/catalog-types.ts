/** 画廊画作元数据（与 assets/gallery-images.json 字段对齐） */
export type GallerySize = "sm" | "md" | "lg";

export interface GalleryWork {
  id: string;
  /** 中文标题 */
  titleZh: string;
  /** 原题 */
  titleEn: string;
  /** 作者中文 */
  artistZh: string;
  /** 作者原文 */
  artistEn: string;
  /** 创作年代（展示用） */
  year: string;
  /** 馆藏/出处简述 */
  note?: string;
}
