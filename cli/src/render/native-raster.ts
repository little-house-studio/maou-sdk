/**
 * Optional Rust term-raster binding（Ink 兼容 paint 加速）。
 * 未编译 / MAOU_NATIVE=0 → null，vram-layer 走 JS。
 */

import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type FlatFrame = {
  cols: number;
  rows: number;
  ch: string[];
  sgr: string[];
  w: number[];
};

export type NativePaintResult = {
  lines: string[];
  out: string;
  dirty: number;
  native: boolean;
};

type Binding = {
  paintDiff: (
    frame: FlatFrame,
    themeBgSgr: string,
    prevLines: string[] | undefined | null,
    forceAll: boolean,
  ) => NativePaintResult;
  rasterVersion: () => string;
};

const require = createRequire(import.meta.url);

let binding: Binding | null | undefined;
let loadAttempted = false;

function nativeDir(): string {
  // dist/render/native-raster.js → cli/native/term-raster
  // src/render/native-raster.ts (tsx) → same relative
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "native", "term-raster");
}

export function loadNativeRaster(): Binding | null {
  if (loadAttempted) return binding ?? null;
  loadAttempted = true;
  if (process.env.MAOU_NATIVE === "0" || process.env.MAOU_NATIVE === "false") {
    binding = null;
    return null;
  }
  try {
    const dir = nativeDir();
    if (!existsSync(dir)) {
      binding = null;
      return null;
    }
    const preferred = [
      join(dir, "maou-term-raster.node"),
      join(dir, `maou-term-raster.${process.platform}-${process.arch}.node`),
    ];
    for (const p of preferred) {
      if (existsSync(p)) {
        binding = require(p) as Binding;
        try {
          // 延迟 import 避免循环
          void import("../hooks/process-stats.js").then((m) => m.setNativeRasterFlag(true));
        } catch {
          /* ignore */
        }
        return binding;
      }
    }
    const nodes = readdirSync(dir).filter((f) => f.endsWith(".node"));
    if (nodes[0]) {
      binding = require(join(dir, nodes[0]!)) as Binding;
      void import("../hooks/process-stats.js").then((m) => m.setNativeRasterFlag(true));
      return binding;
    }
  } catch {
    binding = null;
    return null;
  }
  binding = null;
  return null;
}

export function isNativeRasterLoaded(): boolean {
  return !!loadNativeRaster();
}

export function nativePaintDiff(
  frame: FlatFrame,
  themeBgSgr: string,
  prevLines: string[] | null,
  forceAll: boolean,
): NativePaintResult | null {
  const b = loadNativeRaster();
  if (!b?.paintDiff) return null;
  try {
    return b.paintDiff(frame, themeBgSgr, prevLines, forceAll);
  } catch {
    return null;
  }
}

export function nativeRasterVersion(): string | null {
  const b = loadNativeRaster();
  try {
    return b?.rasterVersion?.() ?? null;
  } catch {
    return null;
  }
}
