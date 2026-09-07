import { afterEach, describe, expect, it } from "vitest";
import { AutoCompressSession } from "../auto-compress.js";
import type { MaouMessage } from "../types/message.js";
import {
  contextModules,
  registerContextModule,
  resetContextModulesForTest,
  resolveContextModule,
  type ContextModule,
} from "./index.js";
import { legacyContextModule } from "./legacy.js";

function msg(category: MaouMessage["category"], text: string, i: number): MaouMessage {
  return {
    seqId: i,
    taskIds: [],
    category,
    contents: [{ text }],
    keepAfterCompress: false,
    createdAt: new Date(Date.now() + i).toISOString(),
  };
}

afterEach(() => {
  resetContextModulesForTest();
});

describe("context modules", () => {
  it("内置 legacy / staged", () => {
    expect(contextModules.list()).toEqual(expect.arrayContaining(["legacy", "staged"]));
    expect(resolveContextModule("staged").id).toBe("staged");
    expect(resolveContextModule("legacy")).toBe(legacyContextModule);
  });

  it("未知 id 抛错", () => {
    expect(() => resolveContextModule("nope")).toThrow(/未知上下文模块/);
  });

  it("同 id 覆盖内置行", () => {
    const stub: ContextModule = {
      id: "staged",
      shouldCompress: () => false,
      compress: async ({ history }) => ({
        compressed: false,
        stage: "activeStage",
        history,
        droppedSummary: "",
        originalTokens: 0,
        compressedTokens: 0,
        blockIds: ["custom"],
      }),
    };
    registerContextModule(stub);
    expect(resolveContextModule("staged")).toBe(stub);
  });

  it("可注册第三方模块并被 AutoCompressSession 调用", async () => {
    let hit = 0;
    registerContextModule({
      id: "echo",
      shouldCompress: () => true,
      compress: async ({ history }) => {
        hit += 1;
        return {
          compressed: true,
          stage: "compactStage",
          history,
          droppedSummary: "echo-ok",
          originalTokens: 10,
          compressedTokens: 9,
          blockIds: [],
        };
      },
    });
    const session = new AutoCompressSession({ mode: "echo", maxTokens: 100, enabled: true });
    session.addMessage(msg("user", "hello", 0));
    await session.getMessages();
    expect(hit).toBe(1);
    expect(session.getLastCompressResult()?.mode).toBe("echo");
    expect(session.getRollingSummary()).toBe("echo-ok");
  });

  it("legacy 留下最近轮，旧轮变成摘要", async () => {
    const history: MaouMessage[] = [];
    for (let i = 0; i < 8; i++) {
      history.push(msg("user", `u${i} ${"x".repeat(400)}`, i * 2));
      history.push(msg("assistant", `a${i} ${"y".repeat(400)}`, i * 2 + 1));
    }
    const result = await legacyContextModule.compress({
      history,
      maxTokens: 200,
      knownTokens: 200,
      currentStage: "activeStage",
      config: {
        triggerPercent: 1,
        keepRecentRounds: 2,
        summarizerPrompt: "",
        summaryModel: {},
      },
    });
    expect(result.compressed).toBe(true);
    expect(result.stage).toBe("summaryStage");
    expect(result.history[0]?.category).toBe("compact");
    const users = result.history.filter((m) => m.category === "user");
    expect(users.length).toBe(2);
  });
});
