import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  carryBootHydration,
  fitChatSnapshot,
  flushBootWrites,
  MAX_CACHED_LINES,
  readBootChat,
  readBootShell,
  saveBootChat,
  saveBootShell,
  setBootStorage,
  type BootChat,
  type BootShell,
} from "./boot-cache.ts";

class MemStorage {
  map = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    const used = [...this.map].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
    if (used + v.length > this.quota) throw new Error("QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const shell = (id: string): BootShell => ({
  agents: [],
  activeAgentName: "ops",
  activeSwitchId: id,
  activeProjectPath: null,
  activityAgents: [],
  meta: null,
});

type Line = { id: string; role: string; text: string; seq?: number; toolDescription?: string; payloadId?: string };

const chat = (n: number, text = "x"): BootChat<Line> => ({
  sessionId: "s1",
  meta: null,
  sessions: [],
  lines: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, role: "user", text, seq: i + 1 })),
  hasMore: false,
  oldestSeq: 1,
  contextUsage: { used: 10, max: 100 },
  contextBreakdown: null,
  maxContext: 100,
  providers: [],
  models: [],
  approval: "yolo",
});

describe("boot cache", () => {
  let mem: MemStorage;
  beforeEach(() => {
    mem = new MemStorage();
    setBootStorage(mem);
  });
  afterEach(() => setBootStorage(null));

  it("round-trips shell and chat snapshots after a flush", () => {
    saveBootShell(shell("system:ops"));
    saveBootChat("system:ops", chat(3));
    assert.equal(readBootShell(), null, "writes are deferred");
    flushBootWrites();
    assert.equal(readBootShell()?.activeSwitchId, "system:ops");
    assert.deepEqual(readBootChat<Line>("system:ops")?.lines.map((l) => l.id), ["l0", "l1", "l2"]);
    assert.equal(readBootChat("nope"), null);
  });

  it("keeps only the last write per key", () => {
    saveBootShell(shell("a"));
    saveBootShell(shell("b"));
    flushBootWrites();
    assert.equal(readBootShell()?.activeSwitchId, "b");
  });

  it("treats corrupt or foreign data as no cache", () => {
    mem.setItem("maou.boot.v1:shell", "{not json");
    assert.equal(readBootShell(), null);
    mem.setItem("maou.boot.v1:shell", JSON.stringify({ hello: 1 }));
    assert.equal(readBootShell(), null);
    setBootStorage(null);
    assert.equal(readBootShell(), null);
  });

  it("keeps chat snapshots for the three most recent agents", () => {
    for (const id of ["a", "b", "c", "d"]) {
      saveBootChat(id, chat(1));
      flushBootWrites();
    }
    assert.equal(readBootChat("a"), null);
    for (const id of ["b", "c", "d"]) assert.ok(readBootChat(id));
  });

  it("trims long threads from the oldest end and marks hasMore", () => {
    const raw = fitChatSnapshot(chat(MAX_CACHED_LINES + 20));
    const parsed = JSON.parse(raw!) as BootChat<Line>;
    assert.equal(parsed.lines.length, MAX_CACHED_LINES);
    assert.equal(parsed.lines[0]!.id, "l20");
    assert.equal(parsed.hasMore, true);
    assert.equal(parsed.oldestSeq, 21);

    const big = fitChatSnapshot(chat(40, "y".repeat(1000)), 12_000);
    const bigParsed = JSON.parse(big!) as BootChat<Line>;
    assert.ok(big!.length <= 12_000);
    assert.ok(bigParsed.lines.length < 40 && bigParsed.lines.length > 0);
    assert.equal(bigParsed.lines.at(-1)!.id, "l39", "newest lines survive");
    assert.equal(fitChatSnapshot(chat(1, "z".repeat(5000)), 1000), null);
  });

  it("survives a full quota by dropping chat snapshots", () => {
    saveBootChat("a", chat(5, "q".repeat(200)));
    flushBootWrites();
    mem.quota = [...mem.map.values()].reduce((n, v) => n + v.length, 0) + 50;
    saveBootShell(shell("system:ops"));
    flushBootWrites();
    assert.equal(readBootShell()?.activeSwitchId, "system:ops");
    assert.equal(readBootChat("a"), null);
  });

  it("carries async-hydrated fields onto fresh lines with the same id", () => {
    const cached: Line[] = [
      { id: "t1", role: "tool", text: "", toolDescription: "读配置" },
      { id: "u1", role: "user", text: "hi", payloadId: "p1" },
    ];
    const fresh: Line[] = [
      { id: "t1", role: "tool", text: "" },
      { id: "u1", role: "user", text: "hi", payloadId: "p9" },
      { id: "new", role: "assistant", text: "yo" },
    ];
    const out = carryBootHydration(cached, fresh);
    assert.equal(out[0]!.toolDescription, "读配置");
    assert.equal(out[1]!.payloadId, "p9", "fresh values win");
    assert.equal(out[2], fresh[2]);
    assert.equal(carryBootHydration([], fresh), fresh);
  });
});
