import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TERMINAL_AUTO_REVIEW_HELPER,
  installTerminalReviewer,
} from "./terminal-reviewer.js";
import { getTerminalReviewer, setTerminalReviewer } from "@little-house-studio/tools";

describe("terminal auto review = helper", () => {
  beforeEach(() => {
    setTerminalReviewer(null);
  });

  it("TERMINAL_AUTO_REVIEW_HELPER 符合 helper 语义", () => {
    expect(TERMINAL_AUTO_REVIEW_HELPER.kind).toBe("helper");
    expect(TERMINAL_AUTO_REVIEW_HELPER.enableLoop).toBe(false);
    expect(TERMINAL_AUTO_REVIEW_HELPER.tools).toEqual([]);
    expect(TERMINAL_AUTO_REVIEW_HELPER.persistContext).toBe(false);
    expect(TERMINAL_AUTO_REVIEW_HELPER.listInManager).toBe(false);
    expect(TERMINAL_AUTO_REVIEW_HELPER.roundLimit).toBe(1);
    expect(TERMINAL_AUTO_REVIEW_HELPER.auxTag).toContain("helper");
  });

  it("installTerminalReviewer 走 Aux callJson（单轮无 tool）", async () => {
    const callJson = vi.fn(async () => ({
      content: '{"approve":false,"reason":"危险"}',
      json: { approve: false, reason: "危险" },
      usage: null,
      ok: true,
      presetName: "fast",
    }));
    const aux = { callJson, callText: vi.fn() } as never;

    installTerminalReviewer({
      llmClient: {} as never,
      auxModelCaller: aux,
      getPreset: () => ({ name: "main", model: "m" }),
      getHelperPreset: () => ({ name: "fast", model: "f" }),
      onMissingPreset: "deny",
    });

    const reviewer = getTerminalReviewer();
    expect(reviewer).toBeTruthy();
    const verdict = await reviewer!("rm -rf /", { agentName: "coding", cwd: "/tmp" });
    expect(verdict.approve).toBe(false);
    expect(verdict.reason).toContain("危险");
    expect(callJson).toHaveBeenCalledOnce();
    const args = callJson.mock.calls[0]![0] as {
      context?: { tag?: string };
      systemPrompt?: string;
      userPrompt?: string;
    };
    expect(args.context?.tag).toBe(TERMINAL_AUTO_REVIEW_HELPER.auxTag);
    expect(args.systemPrompt).toMatch(/无工具|辅助/);
    expect(args.userPrompt).toContain("rm -rf");
  });

  it("无 preset 时 deny", async () => {
    installTerminalReviewer({
      llmClient: {} as never,
      getPreset: () => null,
      onMissingPreset: "deny",
    });
    const verdict = await getTerminalReviewer()!("ls", { agentName: "coding" });
    expect(verdict.approve).toBe(false);
    expect(verdict.reason).toMatch(/preset|helper/);
  });
});
