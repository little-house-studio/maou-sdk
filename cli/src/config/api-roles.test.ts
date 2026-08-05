import { describe, it, expect } from "vitest";
import {
  resolveApiRolePreset,
  resolveGlobalHelperPreset,
  findPresetByRef,
  type LLMPreset,
  type ApiConfig,
} from "@little-house-studio/types";
import { resolveHelperPreset } from "@little-house-studio/llm";

const presets = [
  {
    name: "main-model",
    url: "https://a.example/v1",
    key: "k1",
    model: "big",
    maxTokens: 1,
    protocol: "openai",
    stream: true,
    supportsVision: false,
    supportsReasoning: false,
    nativeToolCalling: true,
    nativeStructuredOutput: true,
  },
  {
    name: "fast-model",
    url: "https://b.example/v1",
    key: "k2",
    model: "small",
    maxTokens: 1,
    protocol: "openai",
    stream: true,
    supportsVision: false,
    supportsReasoning: false,
    nativeToolCalling: true,
    nativeStructuredOutput: true,
  },
  {
    name: "vision-model",
    url: "https://c.example/v1",
    key: "k3",
    model: "see",
    maxTokens: 1,
    protocol: "openai",
    stream: true,
    supportsVision: true,
    supportsReasoning: false,
    nativeToolCalling: true,
    nativeStructuredOutput: true,
  },
  {
    name: "ds-flash/deepseek-v4-flash-free",
    url: "https://d.example/v1",
    key: "k4",
    model: "deepseek-v4-flash-free",
    maxTokens: 1,
    protocol: "openai",
    stream: true,
    supportsVision: false,
    supportsReasoning: true,
    nativeToolCalling: true,
    nativeStructuredOutput: true,
  },
] as LLMPreset[];

function api(partial: Partial<ApiConfig>): ApiConfig {
  return {
    presets,
    defaultPreset: 0,
    agentRoundLimit: 50,
    contextSettings: { thresholdPercent: 70, keepRecentPercent: 25 },
    ...partial,
  };
}

describe("api roles", () => {
  it("find by name / index / model / provider prefix", () => {
    expect(findPresetByRef(presets, "fast-model")?.name).toBe("fast-model");
    expect(findPresetByRef(presets, 2)?.name).toBe("vision-model");
    expect(findPresetByRef(presets, "small")?.name).toBe("fast-model");
    expect(findPresetByRef(presets, "ds-flash")?.name).toBe(
      "ds-flash/deepseek-v4-flash-free",
    );
  });

  it("main from roles / defaultPreset", () => {
    expect(resolveApiRolePreset(api({}), "main")?.name).toBe("main-model");
    expect(
      resolveApiRolePreset(api({ roles: { main: "fast-model" } }), "main")?.name,
    ).toBe("fast-model");
    expect(resolveApiRolePreset(api({ defaultPreset: 1 }), "main")?.name).toBe(
      "fast-model",
    );
  });

  it("helper / fast / vision 回退", () => {
    const withRoles = api({
      roles: { main: 0, fast: "fast-model", vision: "vision-model", helper: 1 },
    });
    expect(resolveApiRolePreset(withRoles, "fast")?.name).toBe("fast-model");
    expect(resolveApiRolePreset(withRoles, "vision")?.name).toBe("vision-model");
    expect(resolveApiRolePreset(withRoles, "helper")?.name).toBe("fast-model");

    // helper 未设 → helperPreset → fast → main
    expect(
      resolveApiRolePreset(api({ helperPreset: 1, roles: { main: 0 } }), "helper")
        ?.name,
    ).toBe("fast-model");

    // vision 未设 → 找 supportsVision（不走 fast）
    expect(resolveApiRolePreset(api({ roles: { main: 0 } }), "vision")?.name).toBe(
      "vision-model",
    );
  });

  it("resolveGlobalHelperPreset 不含 main 回退", () => {
    expect(
      resolveGlobalHelperPreset(api({ roles: { main: 0 } })),
    ).toBeUndefined();
    expect(
      resolveGlobalHelperPreset(api({ roles: { fast: "fast-model" } }))?.name,
    ).toBe("fast-model");
  });

  it("resolveHelperPreset 与全局链一致，并保留 agent 覆盖", () => {
    const main = presets[0]!;
    const asApi = presets as unknown as import("@little-house-studio/llm").APIPreset[];

    // 无 agent：与 resolveApiRolePreset helper 一致（除 main 回退用传入 main）
    expect(
      resolveHelperPreset(undefined, asApi, undefined, main as never, undefined, "fast-model")
        .name,
    ).toBe("fast-model");

    // agent 覆盖优先于 roles.helper
    expect(
      resolveHelperPreset(
        "vision-model",
        asApi,
        undefined,
        main as never,
        "fast-model",
        undefined,
      ).name,
    ).toBe("vision-model");

    // agent 可用厂商前缀
    expect(
      resolveHelperPreset("ds-flash", asApi, undefined, main as never).name,
    ).toBe("ds-flash/deepseek-v4-flash-free");

    // 全空 → mainPreset
    expect(
      resolveHelperPreset(undefined, asApi, undefined, main as never).name,
    ).toBe("main-model");
  });
});
