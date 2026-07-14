/**
 * /new → 落盘空会话 → 重启应读到空指针，而不是 mtime 回退旧对话。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadLastSession,
  persistEmptySession,
  saveLastSession,
} from "./store.js";
import { projectLastSessionPath, projectSessionsDir, projectSessionFile } from "../config/paths.js";

describe("last-session /new 持久化", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "maou-last-sess-"));
    mkdirSync(projectSessionsDir(cwd), { recursive: true });
    // 模拟「旧的大会话」mtime 更新、内容非空
    const oldId = "20260101000000-oldsession";
    writeFileSync(
      projectSessionFile(oldId, cwd),
      `${JSON.stringify({ type: "message", role: "user", content: "old" })}\n`,
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("persistEmptySession 写入指针 + 空 jsonl", () => {
    const id = persistEmptySession("coding", cwd);
    expect(existsSync(projectSessionFile(id, cwd))).toBe(true);
    expect(readFileSync(projectSessionFile(id, cwd), "utf-8")).toBe("");
    const ptr = JSON.parse(readFileSync(projectLastSessionPath(cwd), "utf-8"));
    expect(ptr.sessionId).toBe(id);
    expect(ptr.agentName).toBe("coding");
  });

  it("/new 后 loadLastSession 返回空会话，不回退旧 jsonl", () => {
    const id = persistEmptySession("coding", cwd);
    const last = loadLastSession(cwd, "coding");
    expect(last?.sessionId).toBe(id);
    // 空文件 size=0，若误走 mtime 回退会拿到 oldsession
    expect(last?.sessionId).not.toBe("20260101000000-oldsession");
  });

  it("agentName coding/maou/main 互通，不因别名 miss 指针", () => {
    const id = persistEmptySession("maou", cwd);
    expect(loadLastSession(cwd, "coding")?.sessionId).toBe(id);
    expect(loadLastSession(cwd, "main")?.sessionId).toBe(id);
    expect(loadLastSession(cwd, "maou")?.sessionId).toBe(id);
  });

  it("无指针时才 mtime 回退非空会话", () => {
    // 不写 last-session
    const last = loadLastSession(cwd, "coding");
    expect(last?.sessionId).toBe("20260101000000-oldsession");
  });

  it("指针存在但 session 文件丢失 → 才回退", () => {
    saveLastSession("coding", "missing-id", cwd);
    const last = loadLastSession(cwd, "coding");
    expect(last?.sessionId).toBe("20260101000000-oldsession");
  });
});
