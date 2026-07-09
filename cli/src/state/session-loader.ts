/**
 * session-loader —— 从 .maou/sessions/{id}.jsonl 读会话重建 messages。
 *
 * jsonl 每行一个事件对象：{type:"message", role, content, createdAt, ...}
 * 重建为 ChatMessage[]（user/assistant 纯文本，工具/thinking 等富字段不恢复）。
 */
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ChatMessage } from "./types.js";

export interface LoadedSession {
  messages: ChatMessage[];
  sessionId: string;
}

/** 读会话 jsonl 重建 messages（失败返回 null） */
export function loadSessionMessages(sessionId: string, cwd = process.cwd()): LoadedSession | null {
  const file = join(cwd, ".maou", "sessions", `${sessionId}.jsonl`);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    const messages: ChatMessage[] = [];
    for (const line of lines) {
      let ev: any;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type !== "message") continue;
      const role = ev.role === "user" ? "user" : ev.role === "assistant" ? "assistant" : "system";
      const ts = ev.createdAt ? Date.parse(ev.createdAt) || Date.now() : Date.now();
      messages.push({
        id: `load_${ts}_${Math.random().toString(36).slice(2, 6)}`,
        role,
        content: ev.content ?? "",
        ts,
        streaming: false,
        round: ev.round,
      });
    }
    return { messages, sessionId };
  } catch {
    return null;
  }
}

/** 列出可用会话 id（最新在前） */
export function listSessions(cwd = process.cwd()): string[] {
  const dir = join(cwd, ".maou", "sessions");
  if (!existsSync(dir)) return [];
  try {
    const { readdirSync, statSync } = require("node:fs");
    return readdirSync(dir)
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => ({ id: f.replace(/\.jsonl$/, ""), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a: any, b: any) => b.mtime - a.mtime)
      .map((x: any) => x.id);
  } catch {
    return [];
  }
}
