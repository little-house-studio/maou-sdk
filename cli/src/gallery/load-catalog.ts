/**
 * 从 gallery-images.json 加载画廊元数据（用户可自定义）。
 *
 * 查找顺序（前者整表替换）：
 *   1) <cwd>/.maou/gallery-images.json
 *   2) ~/.maou/gallery-images.json
 *   3) 包内 assets/gallery-images.json
 *
 * 与配色 themes/ 完全分离。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { GalleryWork } from "./catalog-types.js";

export interface GalleryImageEntry extends GalleryWork {
  enabled?: boolean;
  image?: string;
  license?: string;
  tags?: string[];
}

export interface GalleryImagesFile {
  version?: number;
  description?: string;
  works: GalleryImageEntry[];
}

/** 兜底：仅用户自有两幅 */
const BUILTIN_WORKS: GalleryImageEntry[] = [
  {
    id: "fallen-angel",
    enabled: true,
    titleZh: "堕落天使",
    titleEn: "L'Ange déchu / The Fallen Angel",
    artistZh: "亚历山大·卡巴内尔",
    artistEn: "Alexandre Cabanel",
    year: "1847",
    note: "Musée Fabre, Montpellier",
    image: "1.png",
    license: "public-domain",
  },
  {
    id: "dante-virgil",
    enabled: true,
    titleZh: "但丁与维吉尔",
    titleEn: "Dante et Virgile / Dante and Virgil in Hell",
    artistZh: "威廉·阿道夫·布格罗",
    artistEn: "William-Adolphe Bouguereau",
    year: "1850",
    note: "Musée d'Orsay, Paris",
    image: "gallery/dante-virgil.jpg",
    license: "public-domain",
  },
];

function packageAssetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "assets"),
    join(here, "..", "..", "assets"),
  ];
  for (const d of candidates) {
    if (existsSync(join(d, "gallery-images.json"))) return d;
  }
  return candidates[0]!;
}

function tryReadJson(path: string): GalleryImagesFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as GalleryImagesFile;
    if (!raw || !Array.isArray(raw.works)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function resolveGalleryImagesPaths(cwd: string = process.cwd()): {
  project: string;
  user: string;
  package: string;
  active: string | null;
} {
  const project = join(resolve(cwd), ".maou", "gallery-images.json");
  const user = join(homedir(), ".maou", "gallery-images.json");
  const pkg = join(packageAssetsDir(), "gallery-images.json");
  let active: string | null = null;
  if (existsSync(project)) active = project;
  else if (existsSync(user)) active = user;
  else if (existsSync(pkg)) active = pkg;
  return { project, user, package: pkg, active };
}

function normalizeWork(w: GalleryImageEntry): GalleryImageEntry | null {
  if (!w || typeof w.id !== "string" || !w.id.trim()) return null;
  if (w.enabled === false) return null;
  return {
    id: w.id.trim(),
    titleZh: String(w.titleZh ?? w.id),
    titleEn: String(w.titleEn ?? ""),
    artistZh: String(w.artistZh ?? ""),
    artistEn: String(w.artistEn ?? ""),
    year: String(w.year ?? ""),
    note: w.note ? String(w.note) : undefined,
    enabled: true,
    image: w.image ? String(w.image) : undefined,
    license: w.license ? String(w.license) : undefined,
    tags: Array.isArray(w.tags) ? w.tags.map(String) : undefined,
  };
}

let cached: GalleryWork[] | null = null;

export function clearGalleryCatalogCache(): void {
  cached = null;
}

export function loadGalleryWorks(cwd: string = process.cwd()): GalleryWork[] {
  if (cached) return cached;
  const paths = resolveGalleryImagesPaths(cwd);
  const file =
    tryReadJson(paths.project) ??
    tryReadJson(paths.user) ??
    tryReadJson(paths.package);

  const rawWorks = file?.works?.length ? file.works : BUILTIN_WORKS;
  const works: GalleryWork[] = [];
  for (const w of rawWorks) {
    const n = normalizeWork(w);
    if (n) {
      works.push({
        id: n.id,
        titleZh: n.titleZh,
        titleEn: n.titleEn,
        artistZh: n.artistZh,
        artistEn: n.artistEn,
        year: n.year,
        note: n.note,
      });
    }
  }
  cached =
    works.length > 0
      ? works
      : BUILTIN_WORKS.filter((w) => w.enabled !== false).map((w) => ({
          id: w.id,
          titleZh: w.titleZh,
          titleEn: w.titleEn,
          artistZh: w.artistZh,
          artistEn: w.artistEn,
          year: w.year,
          note: w.note,
        }));
  return cached;
}
