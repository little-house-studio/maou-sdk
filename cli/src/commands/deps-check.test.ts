import { describe, it, expect } from "vitest";
import {
  ensureDependencies,
  resolveCliPackageRoot,
  CRITICAL_PACKAGES,
} from "./deps-check.js";

describe("deps-check", () => {
  it("resolveCliPackageRoot 指向 cli 包", () => {
    const root = resolveCliPackageRoot();
    expect(root.length).toBeGreaterThan(0);
  });

  it("开发态核心依赖可解析", async () => {
    const r = await ensureDependencies({ autoInstall: false, quiet: true });
    expect(r.nodeOk).toBe(true);
    // monorepo 下核心包应已 link
    for (const p of CRITICAL_PACKAGES) {
      expect(r.missingCritical.includes(p)).toBe(false);
    }
    expect(r.ok).toBe(true);
  });
});
