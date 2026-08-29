/**
 * /new → 落盘空会话 → 重启应读到空指针，而不是 mtime 回退旧对话。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "@little-house-studio/context";
import {
  loadLastSession,
  persistEmptySession,
  saveLastSession,
} from "./store.js";
import { projectLastSessionPath, projectSessionsDir, projectSessionHeader } from "../config/paths.js";

describe("last-session /new 持久化", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "maou-last-sess-"));
    const store = new SessionStore(projectSessionsDir(cwd));
    const old = store.create({ sessionId: "20260101000000-oldsession", title: "old" });
    store.appendMessage(old.id, "user", "old");
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("persistEmptySession 写入指针 + session.json", () => {
    const id = persistEmptySession("coding", cwd);
    expect(existsSync(projectSessionHeader(id, cwd))).toBe(true);
    const ptr = JSON.parse(readFileSync(projectLastSessionPath(cwd), "utf-8"));
    expect(ptr.sessionId).toBe(id);
    expect(ptr.agentName).toBe("coding");
  });

  it("/new 后 loadLastSession 返回空会话，不回退旧 jsonl", () => {
    const id = persistEmptySession("coding", cwd);
    const last = loadLastSession(cwd, "coding");
    expect(last?.sessionId).toBe(id);
    expect(last?.sessionId).not.toBe("20260101000000-oldsession");
  });

  it("agentName coding/maou/main 互通，不因别名 miss 指针", () => {
    const id = persistEmptySession("maou", cwd);
    expect(loadLastSession(cwd, "coding")?.sessionId).toBe(id);
    expect(loadLastSession(cwd, "main")?.sessionId).toBe(id);
    expect(loadLastSession(cwd, "maou")?.sessionId).toBe(id);
  });

  it("无指针时才 mtime 回退非空会话", () => {
    const last = loadLastSession(cwd, "coding");
    expect(last?.sessionId).toBe("20260101000000-oldsession");
  });

  it("指针存在但 session 文件丢失 → 才回退", () => {
    saveLastSession("coding", "missing-id", cwd);
    const last = loadLastSession(cwd, "coding");
    expect(last?.sessionId).toBe("20260101000000-oldsession");
  });
});
