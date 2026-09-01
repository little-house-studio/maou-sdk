import { describe, expect, it } from "vitest";
import { formatQuietReports } from "./host.js";

describe("formatQuietReports", () => {
  it("wraps each report as a from= envelope", () => {
    expect(
      formatQuietReports([
        { fromSessionId: "sid-1", fromAgent: "help", message: "这边查完了。", at: 1 },
      ]),
    ).toBe(`<message from="help" type="report">这边查完了。</message>`);
  });

  it("falls back to session id when agent name is missing", () => {
    expect(
      formatQuietReports([{ fromSessionId: "sid-1", message: "进度", at: 1 }]),
    ).toBe(`<message from="sid-1" type="report">进度</message>`);
  });
});
