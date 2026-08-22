/**
 * 内置模型目录种子。生成表优先，手写 catalog 作离线兜底。
 */
import type { ProviderSpec } from "./types.js";
import { CATALOG } from "./catalog.js";
import { CATALOG_GENERATED } from "./catalog.generated.js";

export function builtinCatalog(): ProviderSpec[] {
  if (Array.isArray(CATALOG_GENERATED) && CATALOG_GENERATED.length > 0) {
    return CATALOG_GENERATED;
  }
  return CATALOG as unknown as ProviderSpec[];
}
