/**
 * session-loader —— 从 .maou/sessions/{id}.jsonl 读会话重建 messages。
 *
 * 恢复：
 *  - user / assistant 文本
 *  - assistant.toolCalls + 后续 role=tool 结果 → ToolCardState（默认收纳）
 *  - usage / round / 时长（若有）
 */

import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { ChatMessage, ToolCardState } from "./types.js";

export interface LoadedSession {
  messages: ChatMessage[];
  sessionId: string;
}

function asArgs(raw: unknown): string {
  if (raw == null) return "{}";
  if (typeof raw === "string") {
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      return JSON.stringify({ raw });
    }
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return "{}";
  }
}

function toolOk(ev: Record<string, unknown>): boolean {
  const v = ev.tool_ok ?? ev.ok ?? ev.success;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  if (v === true || v === "true" || v === 1 || v === "1" || v === "True") return true;
  // 缺省视为成功（历史数据）
  return true;
}

/** 读会话 jsonl 重建 messages（失败返回 null） */
export function loadSessionMessages(sessionId: string, cwd = process.cwd()): LoadedSession | null {
  const file = join(cwd, ".maou", "sessions", `${sessionId}.jsonl`);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const messages: ChatMessage[] = [];
    /** toolCallId → 所属 assistant 消息在 messages 中的下标 + card 下标 */
    const toolIndex = new Map<string, { msgIdx: number; cardIdx: number }>();

    for (const line of lines) {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (ev.type !== "message") continue;

      const role = String(ev.role ?? "");
      const ts = ev.createdAt
        ? Date.parse(String(ev.createdAt)) || Date.now()
        : Date.now();
      const round = typeof ev.round === "number"
        ? ev.round
        : typeof ev.round === "string"
          ? parseInt(ev.round, 10) || undefined
          : undefined;

      if (role === "user") {
        messages.push({
          id: `load_${ts}_${Math.random().toString(36).slice(2, 6)}`,
          role: "user",
          content: String(ev.content ?? ""),
          ts,
          streaming: false,
          round,
        });
        continue;
      }

      if (role === "assistant") {
        const rawCalls = (ev.toolCalls ?? ev.native_tool_calls ?? []) as Array<
          Record<string, unknown>
        >;
        const toolCalls: ToolCardState[] = rawCalls.map((tc, i) => {
          const id = String(tc.id ?? tc.toolCallId ?? `tc_${ts}_${i}`);
          const name = String(tc.name ?? (tc.function as { name?: string } | undefined)?.name ?? "tool");
          const params = tc.parameters ?? tc.arguments
            ?? (tc.function as { arguments?: unknown } | undefined)?.arguments;
          return {
            id,
            name,
            args: asArgs(params),
            done: false,
            result: undefined,
            isError: false,
          };
        });

        const usageRaw = ev.usage as Record<string, unknown> | undefined;
        const usage = usageRaw
          ? {
              input: Number(usageRaw.prompt_tokens ?? usageRaw.input_tokens ?? 0) || 0,
              output: Number(usageRaw.completion_tokens ?? usageRaw.output_tokens ?? 0) || 0,
            }
          : undefined;

        const msg: ChatMessage = {
          id: `load_${ts}_${Math.random().toString(36).slice(2, 6)}`,
          role: "assistant",
          content: String(ev.content ?? "").replace(/^\n+/, ""),
          ts,
          streaming: false,
          round,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
        };
        const msgIdx = messages.length;
        messages.push(msg);
        toolCalls.forEach((tc, cardIdx) => {
          toolIndex.set(tc.id, { msgIdx, cardIdx });
        });
        continue;
      }

      if (role === "tool") {
        const tid = String(ev.toolCallId ?? ev.tool_call_id ?? "");
        const content = String(ev.content ?? "");
        const ok = toolOk(ev);
        const loc = tid ? toolIndex.get(tid) : undefined;
        if (loc) {
          const m = messages[loc.msgIdx];
          const card = m?.toolCalls?.[loc.cardIdx];
          if (card) {
            // 累加多次 tool 返回
            card.result = card.result ? `${card.result}\n${content}` : content;
            card.done = true;
            card.isError = !ok;
            if (card.name === "tool" && ev.tool_name) {
              card.name = String(ev.tool_name);
            }
          }
        } else {
          // 无配对 tool_call：挂到最近一条 assistant，或新建 system 行
          let attached = false;
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i]!;
            if (m.role === "assistant") {
              const card: ToolCardState = {
                id: tid || `orphan_${ts}`,
                name: String(ev.tool_name ?? "tool"),
                args: asArgs(ev.tool_parameters),
                result: content,
                done: true,
                isError: !ok,
              };
              m.toolCalls = [...(m.toolCalls ?? []), card];
              if (tid) toolIndex.set(tid, { msgIdx: i, cardIdx: m.toolCalls.length - 1 });
              attached = true;
              break;
            }
          }
          if (!attached && content) {
            messages.push({
              id: `load_sys_${ts}_${Math.random().toString(36).slice(2, 6)}`,
              role: "system",
              content: `[tool] ${ev.tool_name ?? ""} ${content}`.trim(),
              ts,
              streaming: false,
            });
          }
        }
        continue;
      }

      // 其它角色 → system
      if (ev.content) {
        messages.push({
          id: `load_sys_${ts}_${Math.random().toString(36).slice(2, 6)}`,
          role: "system",
          content: String(ev.content),
          ts,
          streaming: false,
        });
      }
    }

    // 未配对的 tool_call 标为 done（无结果）
    for (const m of messages) {
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          if (!tc.done && tc.result === undefined) {
            tc.done = true;
            tc.result = "(无结果记录)";
          }
        }
      }
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
    return readdirSync(dir)
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => ({ id: f.replace(/\.jsonl$/, ""), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.id);
  } catch {
    return [];
  }
}
