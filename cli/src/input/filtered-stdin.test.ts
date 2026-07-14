import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createFilteredStdin } from "./filtered-stdin.js";

class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode(m: boolean) {
    this.isRaw = m;
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  resume() {
    return this;
  }
  pause() {
    return this;
  }
}

describe("filtered-stdin Esc", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("裸 ESC 超时后应发出，不能丢弃", async () => {
    const src = new FakeStdin();
    const filtered = createFilteredStdin(src as any);
    const chunks: Buffer[] = [];
    filtered.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));

    src.emit("data", Buffer.from("\x1b"));
    // 挂起等待 CSI 后续；超时前不应写出
    expect(chunks.length).toBe(0);

    await vi.advanceTimersByTimeAsync(60);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.toString("latin1")).toBe("\x1b");
  });

  it("ESC 后紧跟 CSI 鼠标序列应被剥离", async () => {
    const src = new FakeStdin();
    const filtered = createFilteredStdin(src as any);
    const chunks: Buffer[] = [];
    filtered.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));

    src.emit("data", Buffer.from("\x1b[<0;1;1M"));
    expect(chunks.join("")).toBe("");
  });

  it("方向键 CSI 完整序列应透传", async () => {
    const src = new FakeStdin();
    const filtered = createFilteredStdin(src as any);
    const chunks: Buffer[] = [];
    filtered.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));

    // 上箭头 \x1b[A
    src.emit("data", Buffer.from("\x1b[A"));
    const out = Buffer.concat(chunks).toString("latin1");
    expect(out).toBe("\x1b[A");
  });
});
