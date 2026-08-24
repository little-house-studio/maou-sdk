import { describe, it, expect } from "vitest";
import {
  ensureDependencies,
  resolveCliPackageRoot,
  CRITICAL_PACKAGES,
  parseDoctorFlags,
  formatDoctorReportForAgent,
  type DepCheckResult,
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

  it("does not treat install-agent as a core package", () => {
    expect(CRITICAL_PACKAGES).not.toContain("@little-house-studio/install-agent");
  });

  it("parses doctor --agent and --check", () => {
    expect(parseDoctorFlags(["doctor", "--check"])).toEqual({
      noInstall: true,
      agent: false,
    });
    expect(parseDoctorFlags(["doctor", "--agent"])).toEqual({
      noInstall: false,
      agent: true,
    });
    expect(parseDoctorFlags(["doctor", "--no-fix", "--agent"])).toEqual({
      noInstall: true,
      agent: true,
    });
  });

  it("formats a doctor brief for the install agent", () => {
    const brief = formatDoctorReportForAgent({
      ok: true,
      nodeOk: true,
      nodeVersion: "22.0.0",
      missingCritical: [],
      missingOptional: [],
      repaired: [],
      errors: [],
      warnings: [],
      cliRoot: "/x",
      monoRoot: null,
      mode: "bundle",
      bundleRoot: "/b",
      distOk: true,
      tiers: {
        core: true,
        terminal: true,
        dcg: false,
        rg: true,
        sqry: true,
        lspTS: false,
        ddgr: false,
      },
      details: {
        terminalEngine: "mini",
        dcg: "missing",
        rg: "ok",
        sqry: "ok",
        lspTS: "",
        ddgr: "",
        git: "",
        pnpm: "",
        apiConfig: "✓",
        tui: "",
      },
    } as DepCheckResult);
    expect(brief).toContain("bundle");
    expect(brief).toContain("不要执行包管理器全量安装");
    expect(brief).toContain("dcg: 缺");
  });
});
