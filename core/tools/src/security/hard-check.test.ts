import { describe, it, expect } from "vitest";
import { parseHardCheckCommand, runHardCheck } from "./hard-check.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("hard-check", () => {
  it("rejects shell metacharacters", () => {
    const r = parseHardCheckCommand("/tmp/p", "node a.js; rm -rf /");
    expect(r.ok).toBe(false);
  });

  it("rejects -e eval", () => {
    const r = parseHardCheckCommand("/tmp/p", "node -e \"console.log(1)\"");
    expect(r.ok).toBe(false);
  });

  it("accepts node script under project", () => {
    const root = mkdtempSync(join(tmpdir(), "hc-"));
    try {
      writeFileSync(join(root, "check.mjs"), "process.exit(0)\n");
      const r = parseHardCheckCommand(root, "node check.mjs");
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.argv[0]).toBe("node");
        expect(r.argv[1]).toContain("check.mjs");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runHardCheck pass/fail by exit code", async () => {
    const root = mkdtempSync(join(tmpdir(), "hc-run-"));
    try {
      writeFileSync(join(root, "ok.mjs"), "process.exit(0)\n");
      writeFileSync(join(root, "bad.mjs"), "process.exit(2)\n");
      const pass = await runHardCheck({ projectRoot: root, command: "node ok.mjs" });
      expect(pass.ok).toBe(true);
      const fail = await runHardCheck({ projectRoot: root, command: "node bad.mjs" });
      expect(fail.ok).toBe(false);
      expect(fail.code).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
