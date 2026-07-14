import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleEscapeCancel,
  isEscapeKey,
  registerNestedEscapeBack,
  registerAbortStream,
} from "./escape-cancel.js";
import { useStore } from "../state/store.js";

// vram selection helpers — mock getSelection/clear
vi.mock("../render/vram-layer.js", () => ({
  getSelection: vi.fn(() => null),
  clearSelection: vi.fn(),
}));

vi.mock("../render/selection-model.js", () => ({
  clearActiveSel: vi.fn(),
}));

vi.mock("../input/terminal-approval.js", () => ({
  answerTerminalApproval: vi.fn(),
}));

describe("escape-cancel", () => {
  beforeEach(() => {
    registerNestedEscapeBack(null);
    registerAbortStream(null);
    useStore.setState({
      fullEditorInitial: null,
      terminalApproval: null,
      inputTextSel: null,
      completion: null,
      overlay: null,
      streaming: false,
      aborting: false,
    });
  });

  it("isEscapeKey 识别 escape 与裸 ESC", () => {
    expect(isEscapeKey("", { escape: true })).toBe(true);
    expect(isEscapeKey("\x1b", {})).toBe(true);
    expect(isEscapeKey("a", {})).toBe(false);
  });

  it("空闲时 handled=false", () => {
    const r = handleEscapeCancel();
    expect(r.handled).toBe(false);
    expect(r.action).toBe("none");
  });

  it("关闭 overlay", () => {
    useStore.setState({ overlay: "command" });
    const r = handleEscapeCancel();
    expect(r.action).toBe("overlay");
    expect(useStore.getState().overlay).toBe(null);
  });

  it("关闭补全优先于 overlay", () => {
    useStore.setState({
      overlay: "command",
      completion: {
        items: [{ value: "/a", label: "/a" }],
        sel: 0,
        range: { start: 0, end: 1 },
        prefix: "/",
      },
    });
    const r = handleEscapeCancel();
    expect(r.action).toBe("completion");
    expect(useStore.getState().completion).toBe(null);
    expect(useStore.getState().overlay).toBe("command");
  });

  it("嵌套返回优先于关 overlay", () => {
    useStore.setState({ overlay: "settings" });
    let nested = true;
    registerNestedEscapeBack(() => {
      if (nested) {
        nested = false;
        return true;
      }
      return false;
    });
    expect(handleEscapeCancel().action).toBe("nested_back");
    expect(useStore.getState().overlay).toBe("settings");
    expect(handleEscapeCancel().action).toBe("overlay");
    expect(useStore.getState().overlay).toBe(null);
  });

  it("流式中断", () => {
    const abort = vi.fn();
    registerAbortStream(abort);
    useStore.setState({ streaming: true, aborting: false });
    const r = handleEscapeCancel();
    expect(r.action).toBe("abort_stream");
    expect(abort).toHaveBeenCalled();
  });

  it("全屏编辑器退出", () => {
    useStore.setState({ fullEditorInitial: "hello" });
    const r = handleEscapeCancel({ fullEditorValue: "hello world" });
    expect(r.action).toBe("full_editor");
    expect(useStore.getState().fullEditorInitial).toBe(null);
    expect(useStore.getState().fullEditorResult).toBe("hello world");
  });
});
