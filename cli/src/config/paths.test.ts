import { describe, it, expect, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  userMaouRoot,
  projectMaouRoot,
  userConfigPath,
  userHistoryPath,
  projectSessionsDir,
  projectSessionFile,
  projectLastSessionPath,
  MAOU_DIR_NAME,
} from "./paths.js";

describe("paths", () => {
  const prev = process.env.MAOU_HOME;
  const prevLlm = process.env.MAOU_LLM_CONFIG;

  afterEach(() => {
    if (prev === undefined) delete process.env.MAOU_HOME;
    else process.env.MAOU_HOME = prev;
    if (prevLlm === undefined) delete process.env.MAOU_LLM_CONFIG;
    else process.env.MAOU_LLM_CONFIG = prevLlm;
  });

  it("默认 user root = ~/.maou", () => {
    delete process.env.MAOU_HOME;
    delete process.env.MAOU_LLM_CONFIG;
    expect(userMaouRoot()).toBe(join(homedir(), MAOU_DIR_NAME));
    // 无文件时仍指向新文件名
    expect(userConfigPath()).toBe(join(homedir(), ".maou", "config.json"));
    expect(userHistoryPath()).toBe(join(homedir(), ".maou", "history.json"));
  });

  it("MAOU_HOME 覆盖用户根", () => {
    delete process.env.MAOU_LLM_CONFIG;
    process.env.MAOU_HOME = "/tmp/custom-maou";
    expect(userMaouRoot()).toBe("/tmp/custom-maou");
    expect(userConfigPath()).toBe("/tmp/custom-maou/config.json");
  });

  it("MAOU_LLM_CONFIG 覆盖 config 文件路径", () => {
    process.env.MAOU_LLM_CONFIG = "/etc/maou/global-api.json";
    expect(userConfigPath()).toBe("/etc/maou/global-api.json");
  });

  it("project root 相对 cwd", () => {
    expect(projectMaouRoot("/proj")).toBe(join("/proj", ".maou"));
    expect(projectSessionsDir("/proj")).toBe(join("/proj", ".maou", "sessions"));
    expect(projectSessionFile("abc", "/proj")).toBe(
      join("/proj", ".maou", "sessions", "abc.jsonl"),
    );
    expect(projectLastSessionPath("/proj")).toBe(
      join("/proj", ".maou", "last-session.json"),
    );
  });
});
