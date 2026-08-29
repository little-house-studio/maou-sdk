import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAnonFeedbackId } from "./anon-id.js";
import { normalizeRuntimePreset } from "./preset-normalize.js";
import {
  migratePlainKeyToVault,
  migratePresetPlainKey,
  parseKeyRef,
  resolveKeyRef,
} from "./secrets-store.js";

describe("secrets-store + anon-id", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function root(): string {
    const dir = mkdtempSync(join(tmpdir(), "maou-sec-"));
    dirs.push(dir);
    return dir;
  }

  it("parses env and file refs", () => {
    expect(parseKeyRef("env:OPENAI_API_KEY")).toEqual({ kind: "env", name: "OPENAI_API_KEY" });
    expect(parseKeyRef("file:default")).toEqual({ kind: "file", name: "default" });
    expect(parseKeyRef("")).toEqual({ kind: "none" });
  });

  it("resolves env and vault", () => {
    const dir = root();
    expect(resolveKeyRef("env:MAOU_TEST_KEY", { MAOU_TEST_KEY: "from-env" })).toBe("from-env");
    const ref = migratePlainKeyToVault("acme", "sk-secret", dir);
    expect(ref).toBe("file:acme");
    expect(resolveKeyRef(ref, {}, dir)).toBe("sk-secret");
    const dumped = readFileSync(join(dir, "secrets.json"), "utf-8");
    expect(dumped).toContain("sk-secret");
  });

  it("normalizeRuntimePreset resolves keyRef", () => {
    const dir = root();
    migratePlainKeyToVault("acme", "sk-runtime", dir);
    const p = normalizeRuntimePreset(
      { name: "acme", url: "https://x", model: "m", keyRef: "file:acme" },
      { userRoot: dir },
    );
    expect(p.key).toBe("sk-runtime");
    expect(p.keyRef).toBe("file:acme");
  });

  it("migratePresetPlainKey strips key onto vault", () => {
    const dir = root();
    const p: Record<string, unknown> = { name: "z", key: "sk-plain" };
    expect(migratePresetPlainKey(p, dir)).toBe(true);
    expect(p.key).toBeUndefined();
    expect(p.keyRef).toBe("file:z");
    expect(resolveKeyRef(p.keyRef, {}, dir)).toBe("sk-plain");
  });

  it("anon id is stable and not empty", () => {
    const dir = root();
    const a = resolveAnonFeedbackId(dir);
    const b = resolveAnonFeedbackId(dir);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});
