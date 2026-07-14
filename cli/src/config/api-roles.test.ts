import { describe, it, expect } from "vitest";
import {
  resolveApiRolePreset,
  findPresetByRef,
  type LLMPreset,
  type ApiConfig,
} from "@little-house-studio/types";

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
  it("find by name / index", () => {
    expect(findPresetByRef(presets, "fast-model")?.name).toBe("fast-model");
    expect(findPresetByRef(presets, 2)?.name).toBe("vision-model");
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

    // vision 未设 → 找 supportsVision
    expect(resolveApiRolePreset(api({ roles: { main: 0 } }), "vision")?.name).toBe(
      "vision-model",
    );
  });
});
