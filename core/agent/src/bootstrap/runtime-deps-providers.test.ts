import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listModelsForCli,
  listProvidersForCli,
  resolvePresetForCli,
} from "./runtime-deps.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("listProvidersForCli true routes", () => {
  it("does not split 厂商/模型 into fake providers", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-cli-prov-"));
    dirs.push(dir);
    const path = join(dir, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        api: {
          providers: {
            deepseek: {
              displayName: "DeepSeek",
              protocol: "openai",
              url: "https://api.deepseek.com/v1",
              models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
            },
          },
          roles: {
            main: { provider: "deepseek", model: "deepseek-chat" },
          },
        },
      }),
      "utf-8",
    );

    const providers = listProvidersForCli(path);
    expect(providers.map((p) => p.id)).toEqual(["deepseek"]);
    expect(listModelsForCli("deepseek", path).map((m) => m.id)).toEqual([
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
    expect(resolvePresetForCli("deepseek", "deepseek-reasoner", path).model).toBe(
      "deepseek-reasoner",
    );
  });
});
