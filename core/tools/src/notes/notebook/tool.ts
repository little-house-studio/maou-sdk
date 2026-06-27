/**
 * Notebook 工具 — 临时笔记管理
 * 对应 Python: core/tools/impls/notebook_tool.py
 *
 * 创建、读写、挂载/卸下、删除笔记文件。
 * 挂载的笔记会在系统上下文中提醒 agent。
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

const NOTEBOOKS_DIR = "notebooks";
const META_FILENAME = "notebooks.json";

interface NoteMeta {
  name: string;
  description: string;
  file: string;
  mounted: boolean;
  created_at: string;
  updated_at: string;
}

function nowTs(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function safeName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9\-_.]/g, "_").replace(/^_+|_+$/g, "");
  return clean || "note";
}

function loadMeta(filepath: string): NoteMeta[] {
  if (!existsSync(filepath)) return [];
  try {
    const data = JSON.parse(readFileSync(filepath, "utf-8"));
    if (Array.isArray(data)) return data;
    return data?.notes ?? [];
  } catch {
    return [];
  }
}

function saveMeta(filepath: string, notes: NoteMeta[]): void {
  mkdirSync(dirname(filepath), { recursive: true });
  const tmp = filepath + ".tmp";
  writeFileSync(tmp, JSON.stringify({ notes }, null, 2), "utf-8");
  renameSync(tmp, filepath);
}

function findNote(notes: NoteMeta[], name: string): number {
  return notes.findIndex((n) => n.name === name);
}

class NotebookStore {
  private metaPath: string;
  private notesDir: string;

  constructor(maouRoot: string) {
    this.metaPath = join(maouRoot, META_FILENAME);
    this.notesDir = join(maouRoot, NOTEBOOKS_DIR);
  }

  listAll(): NoteMeta[] {
    return loadMeta(this.metaPath);
  }

  get(name: string): NoteMeta | null {
    const notes = loadMeta(this.metaPath);
    const idx = findNote(notes, name);
    return idx >= 0 ? notes[idx] : null;
  }

  create(name: string, description = "", content = ""): string {
    const notes = loadMeta(this.metaPath);
    if (findNote(notes, name) >= 0) throw new Error(`笔记「${name}」已存在，请用其他名称。`);

    mkdirSync(this.notesDir, { recursive: true });
    const filename = safeName(name) + ".md";
    const filepath = join(this.notesDir, filename);
    writeFileSync(filepath, content || "", "utf-8");

    const now = nowTs();
    notes.push({ name, description, file: filename, mounted: true, created_at: now, updated_at: now });
    saveMeta(this.metaPath, notes);
    return `📒 笔记「${name}」已创建 → ${filepath}`;
  }

  read(name: string): { content: string | null; message: string } {
    const notes = loadMeta(this.metaPath);
    const idx = findNote(notes, name);
    if (idx < 0) return { content: null, message: `笔记「${name}」不存在。` };

    const entry = notes[idx];
    const filepath = join(this.notesDir, entry.file);
    if (!existsSync(filepath)) return { content: null, message: `笔记文件 ${entry.file} 丢失。` };

    const content = readFileSync(filepath, "utf-8");
    return { content, message: `📒 ${name}\n${content}` };
  }

  write(name: string, content: string): string {
    const notes = loadMeta(this.metaPath);
    const idx = findNote(notes, name);
    if (idx < 0) throw new Error(`笔记「${name}」不存在。请先 create。`);

    const entry = notes[idx];
    const filepath = join(this.notesDir, entry.file);

    if (existsSync(filepath)) {
      const existing = readFileSync(filepath, "utf-8");
      if (existing === content) return `<notebook>${name} 当前没有更新的内容</notebook>`;
    }

    writeFileSync(filepath, content, "utf-8");
    entry.updated_at = nowTs();
    notes[idx] = entry;
    saveMeta(this.metaPath, notes);
    return `<notebook>${name} 已更新（${content.length} 字）</notebook>`;
  }

  mount(name: string): string {
    const notes = loadMeta(this.metaPath);
    const idx = findNote(notes, name);
    if (idx < 0) throw new Error(`笔记「${name}」不存在。`);
    if (notes[idx].mounted) return `📌 笔记「${name}」已在挂载状态。`;

    notes[idx].mounted = true;
    notes[idx].updated_at = nowTs();
    saveMeta(this.metaPath, notes);

    const entry = notes[idx];
    const filepath = join(this.notesDir, entry.file);
    return `📌 笔记「${name}」已挂载。\n   路径: ${filepath}\n   用途: ${entry.description || "—"}`;
  }

  unmount(name: string): string {
    const notes = loadMeta(this.metaPath);
    const idx = findNote(notes, name);
    if (idx < 0) throw new Error(`笔记「${name}」不存在。`);
    if (!notes[idx].mounted) return `📴 笔记「${name}」未在挂载状态。`;

    notes[idx].mounted = false;
    notes[idx].updated_at = nowTs();
    saveMeta(this.metaPath, notes);
    return `📴 笔记「${name}」已卸下。仍在存储中，可随时 mount 恢复。`;
  }

  delete(name: string): string {
    const notes = loadMeta(this.metaPath);
    const idx = findNote(notes, name);
    if (idx < 0) throw new Error(`笔记「${name}」不存在。`);

    const entry = notes[idx];
    const filepath = join(this.notesDir, entry.file);
    if (existsSync(filepath)) unlinkSync(filepath);

    notes.splice(idx, 1);
    saveMeta(this.metaPath, notes);
    return `🗑️ 笔记「${name}」已删除。`;
  }
}

const storeCache = new Map<string, NotebookStore>();

function getStore(maouRoot: string): NotebookStore {
  if (!storeCache.has(maouRoot)) storeCache.set(maouRoot, new NotebookStore(maouRoot));
  return storeCache.get(maouRoot)!;
}

export class NotebookTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "notebook",
    aliases: [],
    description:
      "临时笔记工具。创建、读写、挂载/卸下、删除笔记文件。" +
      "用于记录任务相关的重要事项、进展、踩坑项、结论等，防止遗忘。" +
      "挂载（mount）表示你需要持续关注此笔记，系统会在上下文中提醒你。" +
      "任务完成后应卸下（unmount）不再需要的笔记。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "read", "write", "mount", "unmount", "delete"],
          description: "list: 列出全部 | create: 创建 | read: 阅读 | write: 写入 | mount: 挂载 | unmount: 卸下 | delete: 删除",
        },
        name: { type: "string", description: "笔记名称" },
        description: { type: "string", description: "笔记用途说明" },
        content: { type: "string", description: "笔记正文内容" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    const store = getStore(ctx.sandboxRoot || ctx.workingDir);

    if (action === "list") {
      const notes = store.listAll();
      if (notes.length === 0) return createToolResponse(true, "暂无笔记");
      const items = notes.map((n) => `${n.mounted ? "📌" : "📴"} ${n.name}`);
      return createToolResponse(true, items.join(", "));
    }

    const name = String(params.name ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name（笔记名称）。");

    try {
      switch (action) {
        case "create": {
          const desc = String(params.description ?? "").trim();
          const content = String(params.content ?? "").trim();
          return createToolResponse(true, store.create(name, desc, content));
        }
        case "read": {
          const { content, message } = store.read(name);
          return createToolResponse(content !== null, message);
        }
        case "write": {
          const content = String(params.content ?? "");
          if (!content) return createToolResponse(false, "write 需要提供 content。");
          return createToolResponse(true, store.write(name, content));
        }
        case "mount":
          return createToolResponse(true, store.mount(name));
        case "unmount":
          return createToolResponse(true, store.unmount(name));
        case "delete":
          return createToolResponse(true, store.delete(name));
        default:
          return createToolResponse(false, `不支持的操作: ${action}`);
      }
    } catch (err) {
      return createToolResponse(false, err instanceof Error ? err.message : String(err));
    }
  }
}
