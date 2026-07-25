import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock store before importing terminal-approval
type TaReq = { id: string; command: string; agentName: string; cwd?: string } | null;
const state: {
  terminalApproval: TaReq;
  approvalMode: "normal" | "auto" | "yolo";
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

const mockReviewer = vi.fn();

vi.mock("../state/store.js", () => ({
  useStore: {
    getState: () => state,
    setState: (partial: Partial<typeof state>) => {
      Object.assign(state, partial);
    },
  },
}));

vi.mock("@little-house-studio/tools", () => ({
  setTerminalApprover: vi.fn(),
  setTerminalPolicyRoot: vi.fn(),
  setTerminalMode: vi.fn(),
  getTerminalMode: vi.fn(() => "normal"),
  getTerminalReviewer: vi.fn(() => mockReviewer),
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
    state.approvalMode = "normal";
    capturedApprover = null;
    mockReviewer.mockReset();
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

  it("auto 模式不弹人手卡，走 AI reviewer", async () => {
    state.approvalMode = "auto";
    mockReviewer.mockResolvedValue({ approve: true, reason: "安全" });
    const p = capturedApprover!("ls -la", { agentName: "coding" });
    // 不应挂起 UI 审批
    expect(state.terminalApproval).toBeNull();
    await expect(p).resolves.toEqual({ approve: true, persist: "whitelist" });
    expect(mockReviewer).toHaveBeenCalled();
  });

  it("yolo 模式直接放行且不弹卡", async () => {
    state.approvalMode = "yolo";
    const p = capturedApprover!("echo hi", { agentName: "coding" });
    expect(state.terminalApproval).toBeNull();
    await expect(p).resolves.toEqual({ approve: true, persist: "none" });
    expect(mockReviewer).not.toHaveBeenCalled();
  });
});
