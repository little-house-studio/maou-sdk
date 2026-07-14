import { describe, it, expect } from "vitest";
import { resolveToolPath, pathGuardFromPolicy, safePath } from "./path-guard.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

describe("path-guard", () => {
  it("safePath 拒绝越界", () => {
    expect(() => safePath("/tmp/proj", "../../etc/passwd")).toThrow(/越过/);
  });

  it("inherit 模式等同单 root", () => {
    const r = resolveToolPath(
      { projectRoot: "/tmp/proj", workingDir: "/tmp/proj" },
      "src/a.ts",
    );
    expect(r.path).toBe(join("/tmp/proj", "src/a.ts"));
    expect(r.needsAudit).toBe(false);
  });

  it("hard 模式只允许 primary root", () => {
    const root = mkdtempSync(join(tmpdir(), "pg-hard-"));
    try {
      const scoped = join(root, "app");
      mkdirSync(scoped, { recursive: true });
      writeFileSync(join(scoped, "ok.ts"), "x");
      const ctx = {
        projectRoot: root,
        workingDir: root,
        pathGuard: { mode: "hard" as const, roots: [scoped] },
      };
      expect(resolveToolPath(ctx, join(scoped, "ok.ts")).needsAudit).toBe(false);
      expect(() => resolveToolPath(ctx, join(root, "outside.ts"))).toThrow(/越界/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("audit 模式：auditRoots 内 needsAudit=true", () => {
    const root = mkdtempSync(join(tmpdir(), "pg-audit-"));
    try {
      const primary = join(root, "proj");
      const audit = join(root, "shared");
      mkdirSync(primary, { recursive: true });
      mkdirSync(audit, { recursive: true });
      const ctx = {
        projectRoot: root,
        workingDir: root,
        pathGuard: {
          mode: "audit" as const,
          roots: [primary],
          auditRoots: [audit],
        },
      };
      expect(resolveToolPath(ctx, join(primary, "a.ts")).needsAudit).toBe(false);
      expect(resolveToolPath(ctx, join(audit, "b.ts")).needsAudit).toBe(true);
      expect(() => resolveToolPath(ctx, join(root, "other", "c.ts"))).toThrow(/越界/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pathGuardFromPolicy project_scoped_audit", () => {
    const g = pathGuardFromPolicy({
      permission: "project_scoped_audit",
      path: "/work/app",
      auditPaths: ["/work/shared"],
    });
    expect(g?.mode).toBe("audit");
    expect(g?.roots[0]).toContain("app");
    expect(g?.auditRoots?.[0]).toContain("shared");
  });
});
