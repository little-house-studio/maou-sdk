import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolvePointerShape,
  setPointerShape,
  resetPointerShape,
  osc22Supported,
} from "./osc22.js";

describe("resolvePointerShape", () => {
  it("优先级：拖选 > 可点 > 输入 > 流式 > 默认", () => {
    expect(resolvePointerShape({ dragging: true, clickable: true, overInput: true })).toBe(
      "grabbing",
    );
    expect(resolvePointerShape({ clickable: true, overInput: true })).toBe("pointer");
    expect(resolvePointerShape({ overInput: true })).toBe("text");
    expect(resolvePointerShape({ streaming: true })).toBe("progress");
    expect(resolvePointerShape({})).toBe("default");
  });
});

describe("setPointerShape", () => {
  const writes: string[] = [];
  let origWrite: typeof process.stdout.write;
  let isTTY: boolean | undefined;
  let prevTermProgram: string | undefined;

  beforeEach(() => {
    writes.length = 0;
    isTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("latin1"));
      return true;
    }) as typeof process.stdout.write;
    process.env.MAOU_POINTER = "1";
    prevTermProgram = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = "ghostty";
    resetPointerShape();
    writes.length = 0;
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
    delete process.env.MAOU_POINTER;
    if (prevTermProgram === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = prevTermProgram;
    resetPointerShape();
  });

  it("写入 OSC 22 序列（ST + BEL）", () => {
    setPointerShape("pointer");
    const joined = writes.join("");
    expect(joined).toContain("]22;pointer");
    expect(joined.includes("\x1b\\") || joined.includes("\x07")).toBe(true);
  });

  it("同形状去重", () => {
    setPointerShape("pointer");
    const n = writes.length;
    setPointerShape("pointer");
    expect(writes.length).toBe(n);
  });

  it("切换形状会再写", () => {
    setPointerShape("pointer");
    setPointerShape("text");
    expect(writes.filter((w) => w.includes("]22;")).length).toBeGreaterThanOrEqual(2);
  });

  it("vscode 宿主默认关闭 OSC 22（除非 MAOU_POINTER=1）", () => {
    delete process.env.MAOU_POINTER;
    process.env.TERM_PROGRAM = "vscode";
    expect(osc22Supported()).toBe(false);
    process.env.MAOU_POINTER = "1";
    expect(osc22Supported()).toBe(true);
  });
});
