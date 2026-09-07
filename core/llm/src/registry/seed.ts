/**
 * 内置模型目录种子。生成表优先，手写 catalog 作离线兜底。
 */
import type { ProviderSpec } from "./types.js";
import { CATALOG } from "./catalog.js";
import { CATALOG_GENERATED } from "./catalog.generated.js";

export function builtinCatalog(): ProviderSpec[] {
  const generated =
    Array.isArray(CATALOG_GENERATED) && CATALOG_GENERATED.length > 0
      ? (CATALOG_GENERATED as unknown as ProviderSpec[])
      : [];
  const handwritten = CATALOG as unknown as ProviderSpec[];
  if (generated.length === 0) return handwritten;
  const have = new Set(generated.map((p) => p.id));
  const extras = handwritten.filter((p) => p?.id && !have.has(p.id));
  return extras.length > 0 ? [...generated, ...extras] : generated;
}
