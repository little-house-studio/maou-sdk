import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCH_DB_FILE } from "../session-search-index.js";
import { LIST_CACHE_FILE } from "../list-cache.js";
import { createAssembly, defineSlot } from "./assembly.js";
import { createFoldPipeline } from "./fold-pipeline.js";
import { createMessageTree } from "./message-tree.js";
import { createContextParts } from "./session-record.js";
import type { MaouMessage } from "../types/message.js";

describe("context factory", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "maou-factory-"));
    dirs.push(dir);
    return dir;
  }

  it("assembly orders, replaces, and removes slots", () => {
    const assembly = createAssembly<{ n: number }>({
      slots: [
        defineSlot({ name: "b", order: 20, provide: () => ({ role: "system", content: "b" }) }),
        defineSlot({ name: "a", order: 10, provide: () => ({ role: "system", content: "a" }) }),
      ],
    });
    expect(assembly.assemble({ n: 1 }).map((m) => m.content)).toEqual(["a", "b"]);

    assembly.insert({
      name: "c",
      order: 15,
      provide: () => ({ role: "system", content: "c" }),
    });
    expect(assembly.assemble({ n: 1 }).map((m) => m.content)).toEqual(["a", "c", "b"]);

    assembly.replace("b", { provide: () => ({ role: "system", content: "B" }) });
    assembly.remove("a");
    expect(assembly.assemble({ n: 1 }).map((m) => m.content)).toEqual(["c", "B"]);
  });

  it("fold pipeline runs steps in order", async () => {
    const msg = (text: string): MaouMessage => ({
      seqId: 1,
      taskIds: [],
      contents: [{ text }],
      keepAfterCompress: false,
      category: "user",
    });
    const fold = createFoldPipeline([
      {
        name: "upper",
        apply: ({ history }) => ({
          history: history.map((m) => ({
            ...m,
            contents: m.contents.map((c) => ({ ...c, text: c.text.toUpperCase() })),
          })),
        }),
      },
      {
        name: "mark",
        apply: ({ history }) => ({
          history: [...history, msg("done")],
        }),
      },
    ]);
    const out = await fold.run({ history: [msg("hi")] });
    expect(out.history.map((m) => m.contents[0]?.text)).toEqual(["HI", "done"]);
  });

  it("message tree selects a branch", () => {
    const tree = createMessageTree([
      { id: "root", parentId: null, visibility: "both" as const },
      { id: "a", parentId: "root", visibility: "both" as const },
      { id: "b", parentId: "root", visibility: "both" as const },
    ]);
    expect(tree.branch("a").map((n) => n.id)).toEqual(["root", "a"]);
    expect(tree.branch("b").map((n) => n.id)).toEqual(["root", "b"]);
  });

  it("createContextParts can turn off search and list cache", () => {
    const dir = tmp();
    const parts = createContextParts({
      sessionDir: dir,
      features: { search: false, listCache: false },
    });
    const session = parts.session.create({ title: "t" });
    parts.session.appendMessage(session.id, "user", "hello");
    expect(parts.session.list()).toHaveLength(1);
    expect(existsSync(join(dir, LIST_CACHE_FILE))).toBe(false);
    expect(existsSync(join(dir, SEARCH_DB_FILE))).toBe(false);
    expect(() => parts.session.search({ query: "hello" })).toThrow(/features.search=false/);
  });

  it("custom assembly without traditional scheme", () => {
    const dir = tmp();
    const parts = createContextParts<{ line: string }>({
      sessionDir: dir,
      features: { search: false, archive: false, listCache: false, foldCache: false },
      slots: [
        defineSlot({ name: "sys", order: 10, provide: () => "tiny agent" }),
        defineSlot({
          name: "user",
          order: 100,
          prefix: false,
          role: "user",
          provide: (ctx) => ctx.line,
        }),
      ],
    });
    const messages = parts.assembly.assemble({ line: "draw a cat" });
    expect(messages).toEqual([
      { role: "system", content: "tiny agent" },
      { role: "user", content: "draw a cat" },
    ]);
  });
});
