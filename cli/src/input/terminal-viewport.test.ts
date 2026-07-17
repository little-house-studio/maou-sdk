import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  noteInputContentWidth,
  maxLineVisualWidth,
  countInputVisualLines,
  inputContentCols,
  markViewportOverflow,
  restoreTerminalViewport,
  bindViewportFullPaint,
  setImePinTarget,
  pinHardwareCursorForIme,
} from "./terminal-viewport.js";

describe("terminal-viewport overflow restore", () => {
  const writes: string[] = [];
  let origWrite: typeof process.stdout.write;
  let isTTY: boolean | undefined;
  let fullPaint = 0;

  beforeEach(() => {
    writes.length = 0;
    fullPaint = 0;
    isTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("latin1"));
      return true;
    }) as typeof process.stdout.write;
    bindViewportFullPaint(() => {
      fullPaint++;
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
    vi.useRealTimers();
    setImePinTarget(null);
  });

  it("maxLineVisualWidth 计中文宽", () => {
    expect(maxLineVisualWidth("ab")).toBe(2);
    expect(maxLineVisualWidth("你好")).toBe(4);
    expect(maxLineVisualWidth("a\n你好呀")).toBe(6);
  });

  it("countInputVisualLines：超长单行按列宽软折", () => {
    expect(countInputVisualLines("", 40)).toBe(1);
    expect(countInputVisualLines("hi", 40)).toBe(1);
    // 80 个 ASCII 在 40 列 → 2 视觉行
    expect(countInputVisualLines("a".repeat(80), 40)).toBe(2);
    // 200 个 ASCII 在 40 列 → 5 视觉行
    expect(countInputVisualLines("a".repeat(200), 40)).toBe(5);
    // 中文宽 2：40 列塞 21 个汉字 → 2 行
    expect(countInputVisualLines("你".repeat(21), 40)).toBe(2);
    // 硬换行 + 软折行叠加
    expect(countInputVisualLines("a".repeat(40) + "\n" + "b".repeat(40), 40)).toBe(2);
    expect(countInputVisualLines("a".repeat(41) + "\n" + "b", 40)).toBe(3);
  });

  it("inputContentCols 预留前缀与滚动条", () => {
    expect(inputContentCols(80)).toBe(77);
    expect(inputContentCols(10)).toBe(8); // 下限
  });

  it("超宽后回落 → 触发 restore + fullPaint", () => {
    // 内容区 10 列，先塞超宽行
    noteInputContentWidth("一二三四五六七八九十十一", 10);
    // 回落
    noteInputContentWidth("短", 10);
    vi.advanceTimersByTime(50);
    expect(fullPaint).toBeGreaterThanOrEqual(1);
    expect(writes.some((w) => w.includes("\x1b[r") || w.includes("\x1b[?7h"))).toBe(true);
  });

  it("从未溢出则 note 回落不 restore", () => {
    fullPaint = 0;
    noteInputContentWidth("hi", 40);
    expect(fullPaint).toBe(0);
  });

  it("pinHardwareCursorForIme 写出 CUP 且钳制在 cols 内", () => {
    setImePinTarget({ focused: true, row: 20, col: 999, cols: 80, rows: 24 });
    pinHardwareCursorForIme();
    const cup = writes.find((w) => /\[\d+;\d+H/.test(w));
    expect(cup).toBeTruthy();
    expect(cup).toMatch(/\[20;80H/); // col 钳到 80
  });

  it("setImePinTarget 越界 col 会 latch，回落后可 restore", () => {
    setImePinTarget({ focused: true, row: 10, col: 200, cols: 80, rows: 24 });
    noteInputContentWidth("ok", 40); // 内容已不溢出 → 清 latch 并 schedule restore
    vi.advanceTimersByTime(50);
    expect(fullPaint).toBeGreaterThanOrEqual(1);
  });

  it("restoreTerminalViewport 直接可调", () => {
    markViewportOverflow();
    restoreTerminalViewport();
    expect(fullPaint).toBeGreaterThanOrEqual(1);
  });
});
