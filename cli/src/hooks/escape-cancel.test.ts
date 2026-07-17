import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../state/store.js", () => {
  const state = {
    fullEditorInitial: null as string | null,
    terminalApproval: null as { id: string } | null,
    inputTextSel: null as { startIdx: number; endIdx: number } | null,
    completion: null as object | null,
    overlay: null as string | null,
    streaming: false,
    aborting: false,
    exitFullEditor: vi.fn(),
    setInputTextSel: vi.fn(),
    closeCompletion: vi.fn(),
    setOverlay: vi.fn(),
  };
  return {
    useStore: {
      getState: () => state,
    },
    __state: state,
  };
});

vi.mock("../input/terminal-approval.js", () => ({
  answerTerminalApproval: vi.fn(),
}));

import { handleEscapeCancel, isEscapeKey } from "./escape-cancel.js";
import { useStore } from "../state/store.js";
import { answerTerminalApproval } from "../input/terminal-approval.js";

const state = (useStore as unknown as { getState: () => Record<string, unknown> }).getState();

beforeEach(() => {
  Object.assign(state, {
    fullEditorInitial: null,
    terminalApproval: null,
    inputTextSel: null,
    completion: null,
    overlay: null,
    streaming: false,
    aborting: false,
  });
  vi.clearAllMocks();
});

describe("handleEscapeCancel", () => {
  it("closes overlay", () => {
    state.overlay = "settings";
    const r = handleEscapeCancel();
    expect(r.handled).toBe(true);
    expect(r.action).toBe("overlay");
    expect(state.setOverlay).toHaveBeenCalledWith(null);
  });

  it("denies terminal approval", () => {
    state.terminalApproval = { id: "a1" };
    const r = handleEscapeCancel();
    expect(r.action).toBe("terminal_approval");
    expect(answerTerminalApproval).toHaveBeenCalledWith("a1", "deny");
  });

  it("idle → none", () => {
    expect(handleEscapeCancel().action).toBe("none");
  });
});

describe("isEscapeKey", () => {
  it("escape flag or \\x1b", () => {
    expect(isEscapeKey("", { escape: true })).toBe(true);
    expect(isEscapeKey("\x1b", {})).toBe(true);
    expect(isEscapeKey("x", {})).toBe(false);
  });
});
