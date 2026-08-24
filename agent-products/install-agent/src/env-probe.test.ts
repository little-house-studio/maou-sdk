import { describe, expect, it } from "vitest";
import { formatEnvProbe, probeEnvironment } from "./env-probe.js";

describe("env-probe", () => {
  it("reports node and os without installing anything", () => {
    const p = probeEnvironment();
    expect(p.node).toMatch(/^v\d/);
    expect(p.os.length).toBeGreaterThan(0);
    expect(p.arch.length).toBeGreaterThan(0);
    expect(p.destWritable).toBeNull();
  });

  it("formats a readable snapshot", () => {
    const text = formatEnvProbe(
      {
        os: "darwin 25",
        arch: "arm64",
        node: "v22.0.0",
        npm: "10.0.0",
        git: "git version 2.0",
        python: null,
        pip: null,
        docker: null,
        destWritable: true,
      },
      "/tmp/app",
    );
    expect(text).toContain("Node: v22.0.0");
    expect(text).toContain("目标目录: /tmp/app");
    expect(text).toContain("Docker: 未找到");
  });
});
