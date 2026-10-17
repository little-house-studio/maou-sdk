/**
 * 后台派发回写文案（不拉 Runtime）。
 * Run: pnpm exec tsx --test src/server/project-dispatch.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatProjectDispatchResult } from "@little-house-studio/tools";

describe("project dispatch write-back text", () => {
  it("includes sessionId so OPS can jump back", () => {
    const text = formatProjectDispatchResult({
      ok: true,
      projectName: "app",
      projectPath: "/repo/app",
      sessionId: "coding-sess",
      output: "lint clean",
    });
    assert.match(text, /后台任务成功/);
    assert.match(text, /sessionId: coding-sess/);
    assert.match(text, /lint clean/);
  });
});
