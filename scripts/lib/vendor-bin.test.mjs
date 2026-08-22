import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vendorBinDir, vendorBinDirFromScriptsDir, isBundleRoot } from "./vendor-bin.mjs";

describe("vendorBinDir", () => {
  it("源码树落到 scripts/vendor/bin", () => {
    const root = mkdtempSync(join(tmpdir(), "maou-vendor-mono-"));
    try {
      mkdirSync(join(root, "scripts"));
      assert.equal(isBundleRoot(root), false);
      assert.equal(vendorBinDir(root), join(root, "scripts", "vendor", "bin"));
      assert.equal(vendorBinDirFromScriptsDir(join(root, "scripts")), join(root, "scripts", "vendor", "bin"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("预编译包落到包根 vendor/bin", () => {
    const root = mkdtempSync(join(tmpdir(), "maou-vendor-bundle-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(join(root, "RELEASE.json"), '{"schema":1,"version":"0.0.0"}');
      assert.equal(isBundleRoot(root), true);
      assert.equal(vendorBinDir(root), join(root, "vendor", "bin"));
      assert.equal(vendorBinDirFromScriptsDir(join(root, "scripts")), join(root, "vendor", "bin"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
