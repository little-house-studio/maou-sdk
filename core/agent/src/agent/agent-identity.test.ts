/**
 * 产品主体 vs 附属服务身份
 */
import { describe, it, expect } from "vitest";
import {
  isCodingAgentIdentity,
  isAllowedSystemAgent,
  isStationedAffiliateAgentName,
  isSwitchableSystemAgent,
  isSwitchableSubjectAgent,
  isProductAgentTemplateName,
} from "./agent-identity.js";

describe("agent-identity product taxonomy", () => {
  it("only ops/coding are product templates", () => {
    expect(isProductAgentTemplateName("ops")).toBe(true);
    expect(isProductAgentTemplateName("coding")).toBe(true);
    expect(isProductAgentTemplateName("proactive")).toBe(false);
    expect(isProductAgentTemplateName("main")).toBe(false);
  });

  it("coding never allowed as system free agent", () => {
    expect(isCodingAgentIdentity("coding")).toBe(true);
    expect(isCodingAgentIdentity("ops", "ops")).toBe(false);
    expect(isCodingAgentIdentity("main", "coding")).toBe(true);
    expect(
      isCodingAgentIdentity("main", "编程助手", "Coding Agent"),
    ).toBe(true);
    expect(isAllowedSystemAgent("coding")).toBe(false);
    expect(isAllowedSystemAgent("main", "coding")).toBe(false);
    expect(isAllowedSystemAgent("ops", "ops")).toBe(true);
  });

  it("stationed affiliates are slaves not free persons", () => {
    expect(isStationedAffiliateAgentName("proactive")).toBe(true);
    expect(isStationedAffiliateAgentName("proactive-scan")).toBe(true);
    expect(isStationedAffiliateAgentName("doc-copilot")).toBe(true);
    expect(isStationedAffiliateAgentName("coding")).toBe(false);
    expect(isAllowedSystemAgent("proactive")).toBe(false);
    expect(
      isSwitchableSubjectAgent({
        name: "proactive",
        list_in_manager: false,
        stationed: true,
      }),
    ).toBe(false);
    expect(
      isSwitchableSubjectAgent({
        name: "explore",
        list_in_manager: true,
      }),
    ).toBe(true);
  });

  it("switchable system rejects coding + affiliates + parented", () => {
    expect(
      isSwitchableSystemAgent({ name: "ops", role: "ops" }),
    ).toBe(true);
    expect(
      isSwitchableSystemAgent({ name: "coding", role: "coding" }),
    ).toBe(false);
    expect(
      isSwitchableSystemAgent({
        name: "proactive",
        list_in_manager: false,
      }),
    ).toBe(false);
    expect(
      isSwitchableSystemAgent({
        name: "helper",
        parent: "ops",
        list_in_manager: true,
      }),
    ).toBe(false);
  });
});
