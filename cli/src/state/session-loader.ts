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
import type { ChatMessage, ToolCardState, SessionEventKind, MessageAuthor } from "./types.js";
import { repairUtf8Mojibake } from "../input/filtered-stdin.js";
import { projectSessionFile, projectSessionsDir } from "../config/paths.js";

function parseAuthor(ev: Record<string, unknown>, kind: SessionEventKind): MessageAuthor {
  const raw = ev.author as MessageAuthor | undefined;
  if (raw && typeof raw === "object" && typeof raw.type === "string") {
    return { type: raw.type, id: raw.id, displayName: raw.displayName ?? raw.id };
  }
  const source = String(ev.source ?? "");
  const toolName = String(ev.tool_name ?? "");
  const from = String(ev.from ?? "");
  const agentName = String(ev.agentName ?? ev.agent_name ?? "");
  if (source === "todo_notice") return { type: "system", id: "todo", displayName: "todo" };
  if (source === "empty_retry") return { type: "system", id: "runtime", displayName: "runtime" };
  if (source === "verification") return { type: "system", id: "verify", displayName: "verify" };
  if (source === "message_bus") return { type: "agent", id: from || "peer", displayName: from || "peer" };
  if (source === "terminal-notification" || kind === "tool_async_notify") {
    return { type: "tool", id: toolName || "use_terminal", displayName: toolName || "use_terminal" };
  }
  if (kind === "human_user" || kind === "queued_user") return { type: "human", id: "user", displayName: "user" };
  if (kind === "assistant_turn") return { type: "agent", id: agentName || "ai", displayName: agentName || "ai" };
  if (kind === "tool_result") return { type: "tool", id: toolName || "tool", displayName: toolName || "tool" };
  if (kind === "agent_message") return { type: "agent", id: from || "agent", displayName: from || "agent" };
  if (kind === "runtime_control") return { type: "system", id: "runtime", displayName: "runtime" };
  if (kind === "system_notice") return { type: "system", id: "system", displayName: "system" };
  return { type: "system", id: "unknown", displayName: "unknown" };
}

/** 与 context resolveSessionEventKind 对齐（轻量本地实现） */
function resolveKind(ev: Record<string, unknown>): SessionEventKind {
  if (typeof ev.kind === "string") {
    const k = ev.kind as SessionEventKind;
    const ok = [
      "human_user", "queued_user", "agent_message", "runtime_control", "system_notice",
      "tool_call", "tool_result", "tool_async_notify", "assistant_turn", "compact", "unknown",
    ];
    if (ok.includes(k)) return k;
  }
  const source = String(ev.source ?? "");
  const map: Record<string, SessionEventKind> = {
    human: "human_user",
    message_bus: "agent_message",
    empty_retry: "runtime_control",
    verification: "runtime_control",
    todo_notice: "system_notice",
    "terminal-notification": "tool_async_notify",
    hook: "system_notice",
  };
  if (map[source]) return map[source];
  const role = String(ev.role ?? "");
  if (role === "tool") {
    const tid = String(ev.toolCallId ?? ev.tool_call_id ?? "");
    return tid.startsWith("term_notify_") ? "tool_async_notify" : "tool_result";
  }
  if (role === "assistant") return "assistant_turn";
  if (role === "user") {
    const c = String(ev.content ?? "");
    if (c.includes("<terminal-message>")) return "tool_async_notify";
    if (c.includes("<system_notice")) return "system_notice";
    if (c.includes("<continue>")) return "runtime_control";
    if (c.startsWith("[来自 ")) return "agent_message";
    if (ev.queued) return "queued_user";
    return "human_user";
  }
  return "unknown";
}

function isNoticeKind(k: SessionEventKind): boolean {
  return k === "system_notice" || k === "runtime_control" || k === "agent_message" || k === "compact";
}

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
  const file = projectSessionFile(sessionId, cwd);
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
        const kind = resolveKind(ev);
        const content = repairUtf8Mojibake(String(ev.content ?? ""));
        // 伪 user → 系统类消息（不画用户气泡）
        if (isNoticeKind(kind) || kind === "tool_async_notify") {
          if (kind === "tool_async_notify" || content.includes("<terminal-message>")) {
            // 走后面 tool 兼容分支：先塞成 assistant 工具卡
            const card: ToolCardState = {
              id: `legacy_term_${ts}`,
              name: "use_terminal",
              args: asArgs({ event: "background_complete", legacy: true }),
              result: content,
              done: true,
              isError: false,
            };
            let attached = false;
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i]!.role === "assistant") {
                messages[i]!.toolCalls = [...(messages[i]!.toolCalls ?? []), card];
                attached = true;
                break;
              }
            }
            if (!attached) {
              messages.push({
                id: `load_tool_${ts}_${Math.random().toString(36).slice(2, 6)}`,
                role: "assistant",
                content: "",
                ts,
                streaming: false,
                toolCalls: [card],
                kind: "tool_async_notify",
                source: String(ev.source ?? "terminal-notification"),
              });
            }
            continue;
          }
          messages.push({
            id: `load_sys_${ts}_${Math.random().toString(36).slice(2, 6)}`,
            role: "system",
            content,
            ts,
            streaming: false,
            round,
            kind,
            source: typeof ev.source === "string" ? ev.source : undefined,
            author: parseAuthor(ev, kind),
          });
          continue;
        }
        messages.push({
          id: `load_${ts}_${Math.random().toString(36).slice(2, 6)}`,
          role: "user",
          content,
          ts,
          streaming: false,
          round,
          kind,
          source: typeof ev.source === "string" ? ev.source : "human",
          author: parseAuthor(ev, kind),
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
          kind: "assistant_turn",
          author: parseAuthor(ev, "assistant_turn"),
          agentName: typeof ev.agentName === "string" ? ev.agentName : undefined,
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
        const isTermNotify =
          ev.source === "terminal-notification" ||
          tid.startsWith("term_notify_");
        const toolName = String(
          ev.tool_name ?? (isTermNotify ? "use_terminal" : "tool"),
        );
        // 终端后台通知：args 标成 background_complete，UI 显示为工具卡而非 user 气泡
        const toolArgs = isTermNotify
          ? asArgs(
              ev.tool_parameters ?? {
                event: "background_complete",
                terminal_id: ev.terminal_id,
              },
            )
          : asArgs(ev.tool_parameters);
        const loc = tid ? toolIndex.get(tid) : undefined;
        if (loc) {
          const m = messages[loc.msgIdx];
          const card = m?.toolCalls?.[loc.cardIdx];
          if (card) {
            // 累加多次 tool 返回
            card.result = card.result ? `${card.result}\n${content}` : content;
            card.done = true;
            card.isError = !ok;
            if (card.name === "tool" && toolName) {
              card.name = toolName;
            }
          }
        } else {
          // 无配对 tool_call：挂到最近一条 assistant（工具卡），或新建 system 行
          let attached = false;
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i]!;
            if (m.role === "assistant") {
              const card: ToolCardState = {
                id: tid || `orphan_${ts}`,
                name: toolName,
                args: toolArgs,
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
            // 会话里尚无 assistant 时：造一条仅含工具卡的 assistant 消息（仍是工具类，非 user）
            const card: ToolCardState = {
              id: tid || `orphan_${ts}`,
              name: toolName,
              args: toolArgs,
              result: content,
              done: true,
              isError: !ok,
            };
            const msg: ChatMessage = {
              id: `load_tool_${ts}_${Math.random().toString(36).slice(2, 6)}`,
              role: "assistant",
              content: "",
              ts,
              streaming: false,
              toolCalls: [card],
            };
            messages.push(msg);
            if (tid) toolIndex.set(tid, { msgIdx: messages.length - 1, cardIdx: 0 });
          }
        }
        continue;
      }

      // 兼容旧数据：曾把终端通知写成 role=user + <terminal-message>
      if (role === "user" && String(ev.content ?? "").includes("<terminal-message>")) {
        const content = repairUtf8Mojibake(String(ev.content ?? ""));
        const card: ToolCardState = {
          id: `legacy_term_${ts}`,
          name: "use_terminal",
          args: asArgs({ event: "background_complete", legacy: true }),
          result: content,
          done: true,
          isError: false,
        };
        let attached = false;
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]!;
          if (m.role === "assistant") {
            m.toolCalls = [...(m.toolCalls ?? []), card];
            attached = true;
            break;
          }
        }
        if (!attached) {
          messages.push({
            id: `load_tool_${ts}_${Math.random().toString(36).slice(2, 6)}`,
            role: "assistant",
            content: "",
            ts,
            streaming: false,
            toolCalls: [card],
          });
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
  const dir = projectSessionsDir(cwd);
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
