import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("cli-ui-prefs", () => {
  let home: string;
  let prevHome: string | undefined;
  let prevMaou: string | undefined;
  let prevPerf: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "maou-cli-ui-"));
    prevHome = process.env.HOME;
    prevMaou = process.env.MAOU_HOME;
    prevPerf = process.env.MAOU_PERF_HUD;
    process.env.HOME = home;
    process.env.MAOU_HOME = join(home, ".maou");
    delete process.env.MAOU_PERF_HUD;
  });

  afterEach(() => {
    if (prevHome !== undefined) process.env.HOME = prevHome;
    else delete process.env.HOME;
    if (prevMaou !== undefined) process.env.MAOU_HOME = prevMaou;
    else delete process.env.MAOU_HOME;
    if (prevPerf !== undefined) process.env.MAOU_PERF_HUD = prevPerf;
    else delete process.env.MAOU_PERF_HUD;
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("save/load perfHud + theme roundtrip", async () => {
    // re-import with current HOME
    const {
      saveCliUiPrefs,
      loadCliUiPrefs,
      resolvePerfHudDefault,
      cliUiConfigPath,
      setPreferredPerfHud,
    } = await import("./cli-ui-prefs.js");

    expect(resolvePerfHudDefault()).toBe(false);
    setPreferredPerfHud(false);
    expect(resolvePerfHudDefault()).toBe(false);
    const p = cliUiConfigPath();
    expect(existsSync(p)).toBe(true);
    const raw = JSON.parse(readFileSync(p, "utf-8")) as { perfHud?: boolean };
    expect(raw.perfHud).toBe(false);

    saveCliUiPrefs({ theme: "demo", perfHud: true });
    const prefs = loadCliUiPrefs();
    expect(prefs.theme).toBe("demo");
    expect(prefs.perfHud).toBe(true);
    expect(prefs.version).toBe(1);
  });

  it("env MAOU_PERF_HUD overrides file", async () => {
    const { setPreferredPerfHud, resolvePerfHudDefault } = await import(
      "./cli-ui-prefs.js"
    );
    setPreferredPerfHud(true);
    process.env.MAOU_PERF_HUD = "0";
    expect(resolvePerfHudDefault()).toBe(false);
  });
});
