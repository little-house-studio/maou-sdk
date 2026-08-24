import { describe, expect, it } from "vitest";
import { defaultInstallDir, inferRepoName, parseAiinstallArgs } from "./parse-args.js";

describe("parseAiinstallArgs", () => {
  it("parses url plus --dir", () => {
    const a = parseAiinstallArgs([
      "https://github.com/foo/bar",
      "--dir",
      "/tmp/bar",
    ]);
    expect(a.task).toBe("https://github.com/foo/bar");
    expect(a.dir).toBe("/tmp/bar");
    expect(a.repair).toBe(false);
    expect(a.isNew).toBe(false);
  });

  it("parses --repair without requiring a directory", () => {
    const a = parseAiinstallArgs(["--repair"]);
    expect(a.repair).toBe(true);
    expect(a.dir).toBeUndefined();
    expect(a.task).toBe("");
  });

  it("parses --new and --help", () => {
    const a = parseAiinstallArgs(["--new", "--help", "装这个项目"]);
    expect(a.isNew).toBe(true);
    expect(a.help).toBe(true);
    expect(a.task).toBe("装这个项目");
  });
});

describe("inferRepoName", () => {
  it("reads github / gitee style urls", () => {
    expect(inferRepoName("https://github.com/acme/hello-world.git")).toBe("hello-world");
    expect(inferRepoName("https://gitee.com/acme/hello")).toBe("hello");
    expect(inferRepoName("随便说说")).toBeUndefined();
  });

  it("defaults dir to ~/Projects/<repo> for hosted urls", () => {
    const dir = defaultInstallDir("https://github.com/acme/hello", "/cwd");
    expect(dir).toMatch(/Projects[/\\]hello$/);
  });

  it("defaults dir to cwd when no repo name", () => {
    expect(defaultInstallDir("装个东西", "/tmp/here")).toBe("/tmp/here");
  });
});
