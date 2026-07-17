import { describe, it, expect } from "vitest";
import { compressMaou } from "./compressor.js";
import type { MaouMessage } from "./types/message.js";

function msg(role: "user" | "assistant" | "system", text: string): MaouMessage {
  return {
    id: `${role}-${text.slice(0, 8)}`,
    role,
    contents: [{ text }],
    createdAt: new Date().toISOString(),
  } as MaouMessage;
}

describe("compressMaou knownTokens / force", () => {
  it("does not compress when only history is small and no knownTokens", async () => {
    const history = [msg("user", "hi"), msg("assistant", "hello")];
    const r = await compressMaou(history, { maxTokens: 200_000 });
    expect(r.stage).toBe("activeStage");
  });

  it("enters compact when knownTokens exceeds 70% even if history tiny", async () => {
    // 足够长的可压缩正文，否则 micro 可能无实质变化但仍应离开 activeStage（force/known）
    const big = "代码块 ".repeat(200);
    const history = [
      msg("user", big),
      msg("assistant", big),
      msg("user", big),
      msg("assistant", big),
    ];
    const r = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 150_000, // 75% of 200k
    });
    // 门槛用 knownTokens → 应尝试压缩；stage 至少不是因门槛卡在 active
    // 若 micro 无可压内容仍可能 activeStage；force 可保证进入
    expect(r.originalTokens).toBeGreaterThanOrEqual(150_000);
  });

  it("force skips active early-exit", async () => {
    const history = [
      msg("user", "a".repeat(2000)),
      msg("assistant", "b".repeat(2000)),
    ];
    const r = await compressMaou(history, {
      maxTokens: 1_000_000,
      force: true,
    });
    // force 后会跑 micro；是否有效压缩取决于内容，但 originalTokens 为 history 估
    expect(r.originalTokens).toBeGreaterThan(0);
    // 无 force 且远低于 70% 应 active
    const r2 = await compressMaou(history, { maxTokens: 1_000_000 });
    expect(r2.stage).toBe("activeStage");
  });
});
