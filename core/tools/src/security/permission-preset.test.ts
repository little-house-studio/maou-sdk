import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_PRESET,
  isPermissionPresetId,
  presetFromApproval,
  resolvePermissionPreset,
} from "./permission-preset.js";

describe("permission-preset", () => {
  it("defaults to workspace+ask", () => {
    expect(resolvePermissionPreset().id).toBe(DEFAULT_PERMISSION_PRESET);
    expect(resolvePermissionPreset("nope").approval).toBe("normal");
  });

  it("open+yolo requires a risk confirm phrase", () => {
    const p = resolvePermissionPreset("open+yolo");
    expect(p.approval).toBe("yolo");
    expect(p.isolation).toBe("open");
    expect(p.confirmRisk).toBe("我已了解风险");
  });

  it("names match /approval ask auto yolo", () => {
    expect(resolvePermissionPreset("workspace+ask").name).toBe("ask");
    expect(resolvePermissionPreset("workspace+auto").name).toBe("auto");
    expect(resolvePermissionPreset("open+yolo").name).toBe("yolo");
    expect(resolvePermissionPreset("workspace+auto").label).toBe("审核");
  });

  it("maps old approval switches", () => {
    expect(presetFromApproval("auto").id).toBe("workspace+auto");
    expect(presetFromApproval("yolo").id).toBe("open+yolo");
    expect(isPermissionPresetId("workspace+ask")).toBe(true);
    expect(isPermissionPresetId("normal")).toBe(false);
  });
});
