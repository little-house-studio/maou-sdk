import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getApiPreset,
  loadPresetsFromMaouConfig,
  removeApiPreset,
  saveGlobalApiConfig,
  upsertApiPreset,
} from "./api-presets.js";

const dirs: string[] = [];

function tmpJson(): string {
  const dir = mkdtempSync(join(tmpdir(), "maou-api-presets-"));
  dirs.push(dir);
  return join(dir, "config.json");
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("api-presets", () => {
  it("upserts and loads a preset", () => {
    const path = tmpJson();
    upsertApiPreset(
      {
        name: "openai/gpt-4o",
        model: "gpt-4o",
        url: "https://api.openai.com/v1",
        protocol: "openai",
        key: "sk-test",
      },
      { configPath: path },
    );
    const loaded = loadPresetsFromMaouConfig(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.key).toBe("sk-test");
    expect(getApiPreset("openai/gpt-4o", path)?.model).toBe("gpt-4o");
    const disk = JSON.parse(readFileSync(path, "utf-8")) as {
      api: { providers: Record<string, { key?: string; keyRef?: string }> };
    };
    const first = Object.values(disk.api.providers)[0];
    expect(first?.key).toBeUndefined();
    expect(first?.keyRef).toMatch(/^file:/);
  });

  it("merges by name and can remove", () => {
    const path = tmpJson();
    saveGlobalApiConfig({
      configPath: path,
      replace: true,
      presets: [
        { name: "a", model: "m1", url: "https://x", key: "1", protocol: "openai" },
        { name: "b", model: "m2", url: "https://x", key: "2", protocol: "openai" },
      ],
    });
    upsertApiPreset(
      { name: "a", model: "m1", url: "https://x", key: "1b", protocol: "openai" },
      { configPath: path },
    );
    expect(getApiPreset("a", path)?.key).toBe("1b");
    expect(loadPresetsFromMaouConfig(path)).toHaveLength(2);

    expect(removeApiPreset("b", { configPath: path })).toBe(true);
    expect(loadPresetsFromMaouConfig(path).map((p) => p.name)).toEqual(["a"]);
    expect(removeApiPreset("missing", { configPath: path })).toBe(false);
  });

  it("nests models[] on disk", () => {
    const path = tmpJson();
    upsertApiPreset(
      {
        name: "vendor/m",
        model: "m",
        url: "https://api.example/v1",
        protocol: "openai",
        key: "k",
      },
      { configPath: path },
    );
    const disk = JSON.parse(readFileSync(path, "utf-8")) as {
      api: { providers: Record<string, { models?: unknown[] }> };
    };
    const first = Object.values(disk.api.providers)[0];
    expect(Array.isArray(first?.models)).toBe(true);
  });

  it("clears roles that pointed at a removed preset", () => {
    const path = tmpJson();
    writeFileSync(
      path,
      JSON.stringify({
        api: {
          presets: [
            {
              name: "keep",
              url: "https://x",
              protocol: "openai",
              models: [{ id: "k" }],
            },
            {
              name: "gone",
              url: "https://x",
              protocol: "openai",
              models: [{ id: "g" }],
            },
          ],
          roles: { main: "keep", fast: "gone" },
        },
      }),
      "utf-8",
    );
    removeApiPreset("gone", { configPath: path });
    const disk = JSON.parse(readFileSync(path, "utf-8")) as {
      api: { roles?: Record<string, { provider?: string; model?: string } | string> };
    };
    expect(disk.api.roles?.fast).toBeUndefined();
    const main = disk.api.roles?.main;
    expect(typeof main === "object" ? main?.provider : main).toBe("keep");
  });
});
