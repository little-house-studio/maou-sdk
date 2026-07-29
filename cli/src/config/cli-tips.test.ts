import { describe, it, expect, beforeEach } from "vitest";
import { idleTips, prettyKey, tipsForContext } from "./cli-tips.js";
import {
  registerBuiltinCliCommands,
  resetBuiltinCliCommandsForTest,
} from "../slash/index.js";

beforeEach(() => {
  resetBuiltinCliCommandsForTest();
  registerBuiltinCliCommands();
});

const idle = {
  streaming: false,
  aborting: false,
  hasApproval: false,
  overlay: null,
};

describe("prettyKey", () => {
  it("大写每段：ctrl+k → Ctrl+K", () => {
    expect(prettyKey("ctrl+k")).toBe("Ctrl+K");
    expect(prettyKey("shift+tab")).toBe("Shift+Tab");
    expect(prettyKey("ctrl+,")).toBe("Ctrl+,");
  });
});

describe("idleTips", () => {
  it("含真实绑定的快捷键，且不含伪键 open_agents", () => {
    const tips = idleTips();
    expect(tips).toContain("Ctrl+K 命令面板");
    expect(tips).toContain("Shift+Tab 循环审核模式");
    expect(tips.some((t) => t.includes("open_agents"))).toBe(false);
  });

  it("每条非空且带手势提示", () => {
    const tips = idleTips();
    expect(tips.length).toBeGreaterThan(4);
    expect(tips.every((t) => t.trim().length > 0)).toBe(true);
    expect(tips).toContain("/ 开头输入斜杠命令");
  });
});

describe("tipsForContext", () => {
  it("空闲 → 多条轮播池", () => {
    expect(tipsForContext(idle).length).toBeGreaterThan(1);
  });

  it("上下文态 → 单条钉住", () => {
    expect(tipsForContext({ ...idle, streaming: true })).toHaveLength(1);
    expect(tipsForContext({ ...idle, aborting: true })).toHaveLength(1);
    expect(tipsForContext({ ...idle, hasApproval: true })).toHaveLength(1);
    expect(tipsForContext({ ...idle, overlay: "settings" })).toHaveLength(1);
  });

  it("优先级：中断 > 审批 > 弹层 > 生成中", () => {
    const all = {
      streaming: true,
      aborting: true,
      hasApproval: true,
      overlay: "settings",
    };
    expect(tipsForContext(all)[0]).toContain("中断");
    expect(tipsForContext({ ...all, aborting: false })[0]).toContain("审批");
    expect(
      tipsForContext({ ...all, aborting: false, hasApproval: false })[0],
    ).toContain("Esc 关闭");
    expect(
      tipsForContext({ ...all, aborting: false, hasApproval: false, overlay: null })[0],
    ).toContain("生成中");
  });
});
