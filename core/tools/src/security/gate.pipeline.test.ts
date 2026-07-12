/**
 * 虚拟端到端：模拟 TerminalTool 审批顺序（DCG → maou-hard → policy）
 * 不真正 spawn shell，只验证门禁组合逻辑。
 */
import { afterEach, describe, expect, it } from "vitest";
import { setDcgEvaluatorForTest, evaluateWithDcg, formatDcgDenyMessage } from "./dcg/client.js";
import { checkMaouHardDeny } from "./hard-deny.js";
import { decideCommand, setTerminalPolicyRoot, setMode, addToWhitelist } from "./approval/terminal-policy.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 复制 tool 内 _approve 顺序的纯函数门禁 */
async function gate(
  command: string,
  opts: { yolo?: boolean; agent?: string },
): Promise<{ allowed: boolean; policy?: string; message?: string }> {
  const agent = opts.agent || "test-agent";

  const dcg = await evaluateWithDcg(command, { required: true });
  if (dcg.decision === "deny") {
    return { allowed: false, policy: "dcg-deny", message: formatDcgDenyMessage(dcg) };
  }

  const hard = checkMaouHardDeny(command);
  if (hard) {
    return { allowed: false, policy: "maou-hard-deny", message: hard.reason };
  }

  const decision = decideCommand(command, agent);
  if (decision.action === "deny") {
    return { allowed: false, policy: "deny", message: decision.reason };
  }
  if (opts.yolo) return { allowed: true, policy: "yolo" };
  if (decision.action === "allow") return { allowed: true, policy: "whitelist" };
  if (decision.action === "ask") return { allowed: false, policy: "ask" };
  if (decision.action === "review") return { allowed: false, policy: "review" };
  return { allowed: true };
}

describe("terminal safety pipeline (virtual)", () => {
  let tmp: string;

  afterEach(() => {
    setDcgEvaluatorForTest(null);
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("DCG deny wins over yolo and whitelist", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-term-pol-"));
    setTerminalPolicyRoot(tmp);
    setMode("test-agent", "yolo");
    addToWhitelist("test-agent", "git *");

    setDcgEvaluatorForTest(async (cmd) =>
      /reset\s+--hard/.test(cmd)
        ? {
            decision: "deny",
            command: cmd,
            reason: "hard reset blocked",
            ruleId: "core.git:reset-hard",
            packId: "core.git",
          }
        : { decision: "allow", command: cmd },
    );

    const blocked = await gate("git reset --hard HEAD", { yolo: true, agent: "test-agent" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.policy).toBe("dcg-deny");
    expect(blocked.message).toMatch(/DCG|hard reset/i);

    const ok = await gate("git status", { yolo: true, agent: "test-agent" });
    expect(ok.allowed).toBe(true);
  });

  it("maou hard deny for reboot even if DCG allows", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({ decision: "allow", command: cmd }));
    const r = await gate("sudo reboot now", { yolo: true });
    expect(r.allowed).toBe(false);
    expect(r.policy).toBe("maou-hard-deny");
  });

  it("safe command: DCG allow + no hard deny + yolo → allow", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({ decision: "allow", command: cmd }));
    const r = await gate("npm run build", { yolo: true });
    expect(r.allowed).toBe(true);
  });

  it("normal mode asks for unknown non-destructive command", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-term-pol2-"));
    setTerminalPolicyRoot(tmp);
    setMode("test-agent", "normal");
    setDcgEvaluatorForTest(async (cmd) => ({ decision: "allow", command: cmd }));

    const r = await gate("curl https://example.com", { yolo: false, agent: "test-agent" });
    expect(r.allowed).toBe(false);
    expect(r.policy).toBe("ask");
  });
});
