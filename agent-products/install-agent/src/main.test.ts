import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@little-house-studio/types";
import { createStreamEventPrinter } from "./main.js";

function collect(): {
  out: string;
  err: string;
  print: (ev: StreamEvent) => void;
} {
  let out = "";
  let err = "";
  const print = createStreamEventPrinter(
    { write: (s: string) => {
      out += s;
      return true;
    } } as NodeJS.WritableStream,
    { write: (s: string) => {
      err += s;
      return true;
    } } as NodeJS.WritableStream,
  );
  return {
    get out() {
      return out;
    },
    get err() {
      return err;
    },
    print,
  };
}

describe("createStreamEventPrinter", () => {
  it("does not reprint a full assistant after streamed deltas", () => {
    const io = collect();
    io.print({ type: "assistant_delta", delta: "请执行：" });
    io.print({ type: "assistant_delta", delta: "brew install foo" });
    io.print({ type: "assistant", content: "请执行：brew install foo" });
    expect(io.out).toBe("请执行：brew install foo\n");
  });

  it("prints assistant once when there were no deltas", () => {
    const io = collect();
    io.print({ type: "assistant", content: "指令已处理" });
    expect(io.out).toBe("指令已处理\n");
  });

  it("resets after a streamed assistant so the next unstreamed reply still prints", () => {
    const io = collect();
    io.print({ type: "assistant_delta", delta: "第一轮" });
    io.print({ type: "assistant", content: "第一轮" });
    io.print({ type: "assistant", content: "第二轮无流式" });
    expect(io.out).toBe("第一轮\n第二轮无流式\n");
  });

  it("writes tool calls to stderr only", () => {
    const io = collect();
    io.print({
      type: "tool_call",
      tool: { name: "use_terminal", parameters: { command: "ls" } },
    });
    expect(io.out).toBe("");
    expect(io.err).toBe("→ use_terminal ls\n");
  });
});
