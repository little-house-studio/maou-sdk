/**
 * 启动时同步画廊：检测 catalog / 源图变更 → 自动重烘焙 ASCII。
 *
 * 便于用户自定义：
 *   1) 改 assets/gallery-images.json
 *   2) 放入 works/<id>/source.jpg（或 assets/gallery/<id>.jpg）
 *   3) 重启 maou coding → 自动 bake sm/md/lg
 *
 * 跳过：MAOU_SKIP_GALLERY_SYNC=1
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { clearGalleryCatalogCache } from "./load-catalog.js";

const SIZES = ["sm", "md", "lg"] as const;

export interface GallerySyncResult {
  rebuilt: string[];
  skipped: string[];
  missing: string[];
  errors: string[];
}

/**
 * 包根（含 assets/ + scripts/）。
 * - 开发：cli/src/gallery → cli
 * - 产物：cli/dist/gallery → 若 dist 无 scripts 则上溯到 cli
 */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", ".."), // src/gallery → cli  或  dist/gallery → dist
    join(here, "..", "..", ".."), // dist/gallery → cli
  ];
  for (const c of candidates) {
    const hasAssets =
      existsSync(join(c, "assets", "gallery-images.json")) ||
      existsSync(join(c, "assets", "themes"));
    const hasScript = existsSync(join(c, "scripts", "bake-gallery-ascii.mjs"));
    if (hasAssets && hasScript) return c;
    if (hasAssets) return c;
  }
  return candidates[0]!;
}

function worksDir(root: string): string {
  // 优先写回源码树 works（开发可检入）；否则 dist/gallery/works
  const srcWorks = join(root, "src", "gallery", "works");
  if (existsSync(srcWorks) || existsSync(join(root, "src", "gallery"))) {
    mkdirSync(srcWorks, { recursive: true });
    return srcWorks;
  }
  const distWorks = join(root, "gallery", "works");
  mkdirSync(distWorks, { recursive: true });
  return distWorks;
}

function catalogPath(root: string): string | null {
  const p = join(root, "assets", "gallery-images.json");
  return existsSync(p) ? p : null;
}

function bakeScript(root: string): string | null {
  const p = join(root, "scripts", "bake-gallery-ascii.mjs");
  if (existsSync(p)) return p;
  const p2 = join(root, "..", "scripts", "bake-gallery-ascii.mjs");
  return existsSync(p2) ? p2 : null;
}

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function findSource(workDir: string, workId: string, root: string): string | null {
  const names = [
    "source.jpg",
    "source.png",
    "source.jpeg",
    "source.webp",
    "source-commons.jpg",
  ];
  for (const n of names) {
    const p = join(workDir, n);
    if (existsSync(p)) return p;
  }
  // assets/gallery/<id>.*
  const gal = join(root, "assets", "gallery");
  if (existsSync(gal)) {
    for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
      const p = join(gal, `${workId}${ext}`);
      if (existsSync(p)) return p;
    }
  }
  // assets/1.png style for fallen-angel
  const rootAssets = join(root, "assets");
  if (existsSync(rootAssets)) {
    for (const f of readdirSync(rootAssets)) {
      if (f.startsWith(".") || f === "gallery" || f === "themes") continue;
      if (/\.(png|jpe?g|webp)$/i.test(f) && f.toLowerCase().includes(workId.slice(0, 6))) {
        return join(rootAssets, f);
      }
    }
  }
  // fallen-angel often uses assets/1.png
  if (workId === "fallen-angel") {
    for (const n of ["1.png", "1.jpg"]) {
      const p = join(root, "assets", n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function needsRebuild(
  workDir: string,
  sourcePath: string | null,
  catalogMtime: number,
): boolean {
  for (const size of SIZES) {
    const txt = join(workDir, `${size}.txt`);
    if (!existsSync(txt)) return true;
    const txtM = mtimeMs(txt);
    if (catalogMtime > txtM + 500) return true;
    if (sourcePath && mtimeMs(sourcePath) > txtM + 500) return true;
  }
  return false;
}

function bakeOne(
  script: string,
  source: string,
  outDir: string,
): { ok: boolean; error?: string } {
  const r = spawnSync(
    process.execPath,
    [script, "--src", source, "--out", outDir, "--mode", "dither", "--polarity", "dark"],
    { encoding: "utf-8", env: process.env },
  );
  if (r.status !== 0) {
    return {
      ok: false,
      error: (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 200),
    };
  }
  return { ok: true };
}

interface CatalogFile {
  works?: Array<{ id?: string; enabled?: boolean; image?: string }>;
}

/**
 * 检测 catalog / 源图变更并重烘焙。
 * @returns 结果摘要
 */
export function syncGalleryOnStartup(opts?: {
  force?: boolean;
  log?: (msg: string) => void;
}): GallerySyncResult {
  const log = opts?.log ?? (() => {});
  const result: GallerySyncResult = {
    rebuilt: [],
    skipped: [],
    missing: [],
    errors: [],
  };

  if (process.env.MAOU_SKIP_GALLERY_SYNC === "1" && !opts?.force) {
    log("gallery sync skipped (MAOU_SKIP_GALLERY_SYNC=1)");
    return result;
  }

  const root = packageRoot();
  const cat = catalogPath(root);
  if (!cat) {
    result.errors.push("gallery-images.json not found");
    return result;
  }

  let catalog: CatalogFile;
  try {
    catalog = JSON.parse(readFileSync(cat, "utf-8")) as CatalogFile;
  } catch (e) {
    result.errors.push(`catalog parse: ${e}`);
    return result;
  }

  const works = (catalog.works ?? []).filter(
    (w) => w?.id && w.enabled !== false,
  );
  const wdirRoot = worksDir(root);
  const script = bakeScript(root);
  const catalogMtime = mtimeMs(cat);

  clearGalleryCatalogCache();

  for (const w of works) {
    const id = w.id!;
    const workDir = join(wdirRoot, id);
    mkdirSync(workDir, { recursive: true });

    let source = findSource(workDir, id, root);
    // catalog.image relative to assets/
    if (!source && w.image) {
      const imgPath = join(root, "assets", w.image);
      if (existsSync(imgPath)) source = imgPath;
    }

    if (!source) {
      // still have baked ascii?
      if (SIZES.every((s) => existsSync(join(workDir, `${s}.txt`)))) {
        result.skipped.push(id);
        continue;
      }
      result.missing.push(id);
      continue;
    }

    // ensure works/<id>/source.* for bake locality
    const localSrc = join(workDir, `source${source.match(/\.\w+$/)?.[0] ?? ".jpg"}`);
    if (resolve(source) !== resolve(localSrc)) {
      try {
        if (!existsSync(localSrc) || mtimeMs(source) > mtimeMs(localSrc)) {
          copyFileSync(source, localSrc);
          source = localSrc;
        } else {
          source = localSrc;
        }
      } catch {
        /* use original path */
      }
    }

    if (!opts?.force && !needsRebuild(workDir, source, catalogMtime)) {
      result.skipped.push(id);
      continue;
    }

    if (!script) {
      result.errors.push(`${id}: bake script missing`);
      continue;
    }

    log(`gallery: baking ${id}…`);
    const r = bakeOne(script, source, workDir);
    if (r.ok) {
      result.rebuilt.push(id);
    } else {
      result.errors.push(`${id}: ${r.error}`);
    }
  }

  // stamp
  try {
    writeFileSync(
      join(wdirRoot, ".gallery-sync.json"),
      JSON.stringify(
        {
          at: new Date().toISOString(),
          catalog: cat,
          rebuilt: result.rebuilt,
          skipped: result.skipped,
        },
        null,
        2,
      ) + "\n",
    );
  } catch {
    /* ignore */
  }

  clearGalleryCatalogCache();
  return result;
}
