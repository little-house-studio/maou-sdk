/**
 * 模型 SVG 探针结果落盘（用户态 ~/.maou/model-svg-probes）
 *
 * - gallery：历次测试缩略图 + 时间
 * - reference：按 model key 存「标准参考图」便于对比是否降智
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { ModelSvgProbeResult } from "@little-house-studio/llm";

export type SvgProbeGalleryItem = {
  id: string;
  createdAt: string;
  model: string;
  presetName: string;
  subject: string;
  latencyMs: number;
  ok: boolean;
  extracted: boolean;
  error?: string;
  /** 相对 shots 的文件名 */
  svgFile?: string;
  /** data URL（列表时可选省略大字段，详情再读） */
  imageDataUrl?: string;
  isReference?: boolean;
};

function resolveRoot(): string {
  const home = process.env.MAOU_HOME?.trim();
  return home ? resolve(home) : join(homedir(), ".maou");
}

export function resolveSvgProbeDir(): string {
  return join(resolveRoot(), "model-svg-probes");
}

function shotsDir(): string {
  return join(resolveSvgProbeDir(), "shots");
}

function refsDir(): string {
  return join(resolveSvgProbeDir(), "refs");
}

function indexPath(): string {
  return join(resolveSvgProbeDir(), "gallery.json");
}

function ensureDirs(): void {
  mkdirSync(shotsDir(), { recursive: true });
  mkdirSync(refsDir(), { recursive: true });
}

function safeKey(model: string, presetName: string): string {
  const raw = `${presetName || "preset"}__${model || "model"}`;
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function readIndex(): SvgProbeGalleryItem[] {
  const p = indexPath();
  if (!existsSync(p)) return [];
  try {
    const j = JSON.parse(readFileSync(p, "utf-8")) as unknown;
    return Array.isArray(j) ? (j as SvgProbeGalleryItem[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(items: SvgProbeGalleryItem[]): void {
  ensureDirs();
  writeFileSync(indexPath(), `${JSON.stringify(items, null, 2)}\n`, "utf-8");
}

function loadSvgDataUrl(svgFile: string | undefined): string | undefined {
  if (!svgFile) return undefined;
  const fp = join(shotsDir(), svgFile);
  if (!existsSync(fp)) return undefined;
  try {
    const svg = readFileSync(fp, "utf-8");
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return undefined;
  }
}

/** 保存一次探针结果到画廊 */
export function saveSvgProbeShot(
  result: ModelSvgProbeResult,
  meta: { presetName: string },
): SvgProbeGalleryItem {
  ensureDirs();
  const id = `${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const createdAt = new Date().toISOString();
  let svgFile: string | undefined;
  let imageDataUrl = result.imageDataUrl;

  if (result.svg) {
    svgFile = `${id}.svg`;
    writeFileSync(join(shotsDir(), svgFile), result.svg, "utf-8");
    if (!imageDataUrl) {
      imageDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
    }
  }

  const item: SvgProbeGalleryItem = {
    id,
    createdAt,
    model: result.model,
    presetName: meta.presetName,
    subject: result.subject,
    latencyMs: result.latencyMs,
    ok: result.ok,
    extracted: result.extracted,
    error: result.error,
    svgFile,
    imageDataUrl,
  };

  const list = readIndex();
  list.unshift(item);
  // 最多保留 40 条
  const kept = list.slice(0, 40);
  const drop = list.slice(40);
  for (const d of drop) {
    if (d.svgFile) {
      try {
        unlinkSync(join(shotsDir(), d.svgFile));
      } catch {
        /* ignore */
      }
    }
  }
  writeIndex(kept.map(({ imageDataUrl: _u, ...rest }) => rest));

  return item;
}

/** 画廊列表（可按 model 过滤）；附带 data URL 便于前端缩略图 */
export function listSvgProbeGallery(filter?: {
  model?: string;
  presetName?: string;
  limit?: number;
}): {
  items: SvgProbeGalleryItem[];
  reference: SvgProbeGalleryItem | null;
  dir: string;
} {
  ensureDirs();
  let items = readIndex();
  const model = filter?.model?.trim();
  const presetName = filter?.presetName?.trim();
  if (model) {
    items = items.filter((x) => x.model === model);
  }
  if (presetName) {
    items = items.filter((x) => x.presetName === presetName);
  }
  const limit =
    typeof filter?.limit === "number" && filter.limit > 0
      ? Math.min(filter.limit, 40)
      : 24;
  items = items.slice(0, limit).map((it) => ({
    ...it,
    imageDataUrl: loadSvgDataUrl(it.svgFile) ?? it.imageDataUrl,
  }));

  const ref =
    model || presetName
      ? loadReference(model || items[0]?.model || "", presetName || items[0]?.presetName || "")
      : null;

  return { items, reference: ref, dir: resolveSvgProbeDir() };
}

/** 将某次 shot 设为该 model/preset 的标准参考 */
export function setSvgProbeReference(shotId: string): SvgProbeGalleryItem {
  ensureDirs();
  const list = readIndex();
  const shot = list.find((x) => x.id === shotId);
  if (!shot) throw new Error(`shot not found: ${shotId}`);
  if (!shot.svgFile) throw new Error("该记录没有可参考的 SVG");

  const src = join(shotsDir(), shot.svgFile);
  if (!existsSync(src)) throw new Error("SVG 文件丢失");

  const key = safeKey(shot.model, shot.presetName);
  const refSvg = `${key}.svg`;
  const refMeta = `${key}.json`;
  writeFileSync(join(refsDir(), refSvg), readFileSync(src));
  const item: SvgProbeGalleryItem = {
    ...shot,
    isReference: true,
    svgFile: refSvg,
    imageDataUrl: loadSvgDataUrlFromPath(join(refsDir(), refSvg)),
  };
  // gallery 里的 svgFile 指向 shots；reference 单独存
  const storeItem = { ...item, svgFile: refSvg };
  writeFileSync(
    join(refsDir(), refMeta),
    `${JSON.stringify(
      {
        ...storeItem,
        imageDataUrl: undefined,
        refSvg,
        setAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  return item;
}

function loadSvgDataUrlFromPath(fp: string): string | undefined {
  if (!existsSync(fp)) return undefined;
  try {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(readFileSync(fp, "utf-8"))}`;
  } catch {
    return undefined;
  }
}

export function loadReference(
  model: string,
  presetName: string,
): SvgProbeGalleryItem | null {
  ensureDirs();
  const key = safeKey(model, presetName);
  const metaPath = join(refsDir(), `${key}.json`);
  const svgPath = join(refsDir(), `${key}.svg`);
  if (!existsSync(metaPath) || !existsSync(svgPath)) {
    // 也试仅 model
    const key2 = safeKey(model, "");
    const m2 = join(refsDir(), `${key2}.json`);
    const s2 = join(refsDir(), `${key2}.svg`);
    if (existsSync(m2) && existsSync(s2)) {
      try {
        const meta = JSON.parse(readFileSync(m2, "utf-8")) as SvgProbeGalleryItem;
        return {
          ...meta,
          isReference: true,
          imageDataUrl: loadSvgDataUrlFromPath(s2),
        };
      } catch {
        return null;
      }
    }
    return null;
  }
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as SvgProbeGalleryItem;
    return {
      ...meta,
      isReference: true,
      imageDataUrl: loadSvgDataUrlFromPath(svgPath),
    };
  } catch {
    return null;
  }
}

/** 调试：列出 refs 文件名 */
export function listRefFiles(): string[] {
  ensureDirs();
  try {
    return readdirSync(refsDir());
  } catch {
    return [];
  }
}
