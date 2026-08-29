/**
 * 会话快照 —— 记 leaf，回滚只改当前叶，不覆盖 events.jsonl。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionStore, SessionData, SessionMessage } from "./session-store.js";
import { SESSION_JSON } from "./session-store.js";
import type { CheckpointMeta, CheckpointDiff } from "./types.js";
import { MAX_AUTO_CHECKPOINTS } from "./constants.js";
import { isMessageEventType } from "./session-ledger.js";

function nowIso(): string {
  return new Date().toISOString();
}

function genId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export class CheckpointStore {
  private sessionStore: SessionStore;

  constructor(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  private checkpointDir(sessionId: string): string {
    const dir = join(this.sessionStore.sessionRoot(sessionId), "checkpoints");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private cpRoot(sessionId: string, checkpointId: string): string {
    return join(this.checkpointDir(sessionId), checkpointId);
  }

  createCheckpoint(
    sessionId: string,
    label?: string,
    autoCheckpoint?: boolean,
    triggerReason?: string,
  ): CheckpointMeta {
    const session = this.sessionStore.load(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }
    const header = this.sessionStore.readMeta(sessionId);
    const cpId = genId();
    const dest = this.cpRoot(sessionId, cpId);
    mkdirSync(dest, { recursive: true });

    const meta: CheckpointMeta = {
      id: cpId,
      sessionId,
      label: label ?? `checkpoint_${session.messages.length}_msgs`,
      messageCount: session.messages.length,
      createdAt: nowIso(),
      autoCheckpoint: autoCheckpoint ?? false,
      triggerReason,
      leafSeq: typeof header?.leaf_seq === "number" ? header.leaf_seq : undefined,
      leafId: header?.leaf_id,
    };
    writeFileSync(join(dest, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");

    const eventsPath = this.sessionStore.jsonlPath(sessionId);
    if (existsSync(eventsPath)) {
      copyFileSync(eventsPath, join(dest, "events.jsonl"));
    } else {
      writeFileSync(join(dest, "events.jsonl"), "", "utf-8");
    }
    const sessionJson = this.sessionStore.metaPath(sessionId);
    if (existsSync(sessionJson)) {
      copyFileSync(sessionJson, join(dest, SESSION_JSON));
    }

    if (autoCheckpoint) {
      try {
        this.pruneAutoCheckpoints(sessionId, MAX_AUTO_CHECKPOINTS);
      } catch {
        /* 清理失败不影响主流程 */
      }
    }
    return meta;
  }

  rollbackToCheckpoint(sessionId: string, checkpointId: string): SessionData {
    const dest = this.cpRoot(sessionId, checkpointId);
    const metaFile = join(dest, "meta.json");
    if (!existsSync(metaFile)) {
      throw new Error(`快照不存在: ${checkpointId}`);
    }
    const meta = JSON.parse(readFileSync(metaFile, "utf-8")) as CheckpointMeta;
    const leafId = meta.leafId ?? this._loadCheckpointMessages(sessionId, checkpointId).at(-1)?.id;
    if (!leafId) {
      return this.sessionStore.load(sessionId) ?? this.sessionStore.create({ sessionId });
    }
    this.sessionStore.rollbackTo(sessionId, leafId, meta.leafSeq);
    return this.sessionStore.load(sessionId) ?? this.sessionStore.create({ sessionId });
  }

  diffCheckpoints(sessionId: string, fromCheckpointId: string, toCheckpointId: string): CheckpointDiff {
    return this._computeDiff(
      this._loadCheckpointMessages(sessionId, fromCheckpointId),
      this._loadCheckpointMessages(sessionId, toCheckpointId),
    );
  }

  diffFromCheckpoint(sessionId: string, checkpointId: string): CheckpointDiff {
    const session = this.sessionStore.load(sessionId);
    return this._computeDiff(
      this._loadCheckpointMessages(sessionId, checkpointId),
      session?.messages ?? [],
    );
  }

  listCheckpoints(sessionId: string): CheckpointMeta[] {
    const cpDir = this.checkpointDir(sessionId);
    const metas: CheckpointMeta[] = [];
    for (const name of readdirSync(cpDir)) {
      const metaFile = join(cpDir, name, "meta.json");
      const legacy = join(cpDir, name);
      try {
        if (existsSync(metaFile)) {
          metas.push(JSON.parse(readFileSync(metaFile, "utf-8")) as CheckpointMeta);
          continue;
        }
        if (name.endsWith(".meta.json")) {
          metas.push(JSON.parse(readFileSync(legacy, "utf-8")) as CheckpointMeta);
        }
      } catch {
        continue;
      }
    }
    return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    const dest = this.cpRoot(sessionId, checkpointId);
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  shouldAutoCheckpoint(eventType: "tool_call" | "compression" | "round_start"): boolean {
    return eventType === "compression";
  }

  pruneAutoCheckpoints(sessionId: string, keep: number = MAX_AUTO_CHECKPOINTS): number {
    const all = this.listCheckpoints(sessionId).filter((m) => m.autoCheckpoint);
    if (all.length <= keep) return 0;
    const toDelete = all.slice(keep);
    let n = 0;
    for (const m of toDelete) {
      if (this.deleteCheckpoint(sessionId, m.id)) n++;
    }
    return n;
  }

  private _loadCheckpointMessages(sessionId: string, checkpointId: string): SessionMessage[] {
    const dest = this.cpRoot(sessionId, checkpointId);
    const dataFile = existsSync(join(dest, "events.jsonl"))
      ? join(dest, "events.jsonl")
      : join(this.checkpointDir(sessionId), `${checkpointId}.jsonl`);
    if (!existsSync(dataFile)) return [];
    const messages: SessionMessage[] = [];
    for (const line of readFileSync(dataFile, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (typeof event.type === "string" && isMessageEventType(event.type)) {
          const data = (event.data ?? event) as SessionMessage;
          if (data.role != null || data.content != null) {
            messages.push({
              ...data,
              role: String(data.role ?? "user"),
              content: String(data.content ?? ""),
              createdAt: String(data.createdAt ?? event.ts ?? ""),
              id: (event.messageId as string | undefined) ?? data.id,
            });
          }
        }
      } catch {
        continue;
      }
    }
    return messages;
  }

  private _computeDiff(from: SessionMessage[], to: SessionMessage[]): CheckpointDiff {
    const fromKeys = new Set(from.map((m) => `${m.createdAt}|${m.role}`));
    const toKeys = new Set(to.map((m) => `${m.createdAt}|${m.role}`));
    const added = to.filter((m) => !fromKeys.has(`${m.createdAt}|${m.role}`));
    const removed = from.filter((m) => !toKeys.has(`${m.createdAt}|${m.role}`));
    const snippets = added.slice(0, 10).map((m) => {
      const content = String(m.content ?? "").trim();
      return content.length > 100 ? content.slice(0, 100) + "…" : content;
    });
    return {
      addedMessages: added.length,
      removedMessages: removed.length,
      addedTraces: 0,
      removedTraces: 0,
      messageSnippets: snippets,
    };
  }
}
