import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock store before importing terminal-approval
type TaReq = { id: string; command: string; agentName: string; cwd?: string } | null;
const state: {
  terminalApproval: TaReq;
  approvalMode: "normal";
  agentName: string;
  toastMsg: ReturnType<typeof vi.fn>;
  setTerminalApproval: (req: TaReq) => void;
} = {
  terminalApproval: null,
  approvalMode: "normal",
  agentName: "coding",
  toastMsg: vi.fn(),
  setTerminalApproval: (req) => {
    state.terminalApproval = req;
  },
};

vi.mock("../state/store.js", () => ({
  useStore: {
    getState: () => state,
  },
}));

vi.mock("@little-house-studio/tools", () => ({
  setTerminalApprover: vi.fn(),
  setTerminalPolicyRoot: vi.fn(),
  setTerminalMode: vi.fn(),
}));

import {
  installCliTerminalApprover,
  answerTerminalApproval,
  cancelAllTerminalApprovals,
  uninstallCliTerminalApprover,
} from "./terminal-approval.js";
import { setTerminalApprover } from "@little-house-studio/tools";

// 通过 setTerminalApprover 入参捕获审批器
let capturedApprover: ((cmd: string, ctx: { agentName: string; cwd?: string }) => Promise<unknown>) | null = null;

describe("CLI terminal approval", () => {
  beforeEach(() => {
    state.terminalApproval = null;
    capturedApprover = null;
    vi.mocked(setTerminalApprover).mockImplementation((fn) => {
      capturedApprover = fn as typeof capturedApprover;
    });
    installCliTerminalApprover();
  });

  afterEach(() => {
    uninstallCliTerminalApprover();
  });

  it("approver 阻塞直到 answer once", async () => {
    expect(capturedApprover).toBeTruthy();
    const p = capturedApprover!("echo hello", { agentName: "coding" });
    // 已挂起请求
    expect(state.terminalApproval?.command).toBe("echo hello");
    const id = state.terminalApproval!.id;
    answerTerminalApproval(id, "once");
    await expect(p).resolves.toEqual({ approve: true, persist: "none" });
    expect(state.terminalApproval).toBeNull();
  });

  it("always → whitelist persist", async () => {
    const p = capturedApprover!("npm test", { agentName: "coding" });
    answerTerminalApproval(state.terminalApproval!.id, "always");
    await expect(p).resolves.toEqual({ approve: true, persist: "whitelist" });
  });

  it("deny / blacklist", async () => {
    const p1 = capturedApprover!("rm -rf /", { agentName: "coding" });
    answerTerminalApproval(state.terminalApproval!.id, "deny");
    await expect(p1).resolves.toEqual({ approve: false, persist: "none" });

    const p2 = capturedApprover!("curl evil", { agentName: "coding" });
    answerTerminalApproval(state.terminalApproval!.id, "blacklist");
    await expect(p2).resolves.toEqual({ approve: false, persist: "blacklist" });
  });

  it("cancelAll rejects pending", async () => {
    const p = capturedApprover!("sleep 1", { agentName: "coding" });
    cancelAllTerminalApprovals("aborted");
    await expect(p).rejects.toThrow(/aborted/);
    expect(state.terminalApproval).toBeNull();
  });
});
