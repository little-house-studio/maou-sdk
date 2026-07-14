import { describe, it, expect } from "vitest";
import {
  DEFAULT_AGENT_NAME,
  APPROVAL_AGENT_FALLBACK,
  resolveAgentName,
  usesCodingTemplate,
} from "./defaults.js";

describe("defaults", () => {
  it("resolveAgentName 空串回退", () => {
    expect(resolveAgentName(undefined)).toBe(DEFAULT_AGENT_NAME);
    expect(resolveAgentName("")).toBe(DEFAULT_AGENT_NAME);
    expect(resolveAgentName("  ")).toBe(DEFAULT_AGENT_NAME);
    expect(resolveAgentName("bot")).toBe("bot");
    expect(resolveAgentName(null, APPROVAL_AGENT_FALLBACK)).toBe(APPROVAL_AGENT_FALLBACK);
  });

  it("coding 模板 agent 集合", () => {
    expect(usesCodingTemplate("coding")).toBe(true);
    expect(usesCodingTemplate("main")).toBe(true);
    expect(usesCodingTemplate("other")).toBe(false);
  });
});
