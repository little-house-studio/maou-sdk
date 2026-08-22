import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guessInstallRoot, resolveVendorBinary, vendorBinDirs } from "./vendor-bin.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "maou-vendor-bin-"));
  temps.push(d);
  return d;
}

describe("vendor-bin", () => {
  it("lists scripts/vendor/bin then bundle vendor/bin", () => {
    const root = tmp();
    expect(vendorBinDirs(root)).toEqual([
      join(root, "scripts", "vendor", "bin"),
      join(root, "vendor", "bin"),
    ]);
  });

  it("guesses monorepo root from a nested start", () => {
    const root = tmp();
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const nested = join(root, "core", "tools", "src");
    mkdirSync(nested, { recursive: true });
    expect(guessInstallRoot(nested)).toBe(root);
  });

  it("resolves a binary from scripts/vendor/bin first", () => {
    const root = tmp();
    const dest = join(root, "scripts", "vendor", "bin");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "rg"), "ok");
    expect(resolveVendorBinary(root, "rg")).toBe(join(dest, "rg"));
  });
});
