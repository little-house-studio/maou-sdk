/**
 * Board 工具 — 共享状态看板
 * 对应 Python: core/tools/impls/board_tool.py
 *
 * 存储需要持久追踪的键值参数（角色属性、进度、计数器、标记等）。
 * list/get/add/replace/edit/del，值最长100字。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

const MAX_VALUE_LENGTH = 100;
const RECORDS_FILENAME = "records.json";
const VALID_ACTIONS = new Set(["list", "get", "add", "replace", "edit", "del"]);
const VALID_SCOPES = new Set(["session", "project", "global"]);

interface BoardEntry {
  scope: string;
  name: string;
  value: string;
  type: string;
  category: string;
  owner: string;
  description: string;
  /** session scope 条目归属的 sessionId（其它 scope 为空）。用于多 session 并发隔离。 */
  sessionId?: string;
  created_at: string;
  updated_at: string;
}

function nowTs(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function recordsPath(maouRoot: string): string {
  return join(maouRoot, RECORDS_FILENAME);
}

function readRecords(filepath: string): BoardEntry[] {
  if (!existsSync(filepath)) return [];
  try {
    const data = JSON.parse(readFileSync(filepath, "utf-8"));
    const entries = data?.entries ?? data?.variables ?? [];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function writeRecords(filepath: string, entries: BoardEntry[]): void {
  mkdirSync(dirname(filepath), { recursive: true });
  const tmpPath = filepath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify({ entries }, null, 2), "utf-8");
  renameSync(tmpPath, filepath);
}

function findIndex(entries: BoardEntry[], scope: string, name: string): number {
  return entries.findIndex((e) => e.scope === scope && e.name === name);
}

function formatMdTable(entries: BoardEntry[]): string {
  if (entries.length === 0) return "（看板为空）";
  const lines = ["| scope | category | name | value | type | updated_at |", "|-------|----------|------|-------|------|------------|"];
  for (const e of entries) {
    lines.push(`| ${e.scope} | ${e.category} | ${e.name} | ${e.value} | ${e.type} | ${e.updated_at} |`);
  }
  lines.push(`\n共 ${entries.length} 条`);
  return lines.join("\n");
}

export class BoardStore {
  private filepath: string;

  constructor(maouRoot: string) {
    this.filepath = recordsPath(maouRoot);
  }

  private load(): BoardEntry[] {
    return readRecords(this.filepath);
  }

  private save(entries: BoardEntry[]): void {
    writeRecords(this.filepath, entries);
  }

  listAll(): BoardEntry[] {
    return this.load();
  }

  /** 清空指定 session 的 session-scoped 条目，返回删除数量（不影响其它 session） */
  clearSession(sessionId?: string): number {
    const entries = this.load();
    const before = entries.length;
    // 有 sessionId：只删该 session 的 session 条目；无 sessionId：删全部 session 条目（兼容旧调用）
    const kept = entries.filter((e) => {
      if (e.scope !== "session") return true;
      if (!sessionId) return false;
      return e.sessionId !== sessionId;
    });
    this.save(kept);
    return before - kept.length;
  }

  get(scope: string, name: string): BoardEntry | null {
    const entries = this.load();
    const idx = findIndex(entries, scope, name);
    return idx >= 0 ? entries[idx] : null;
  }

  getByCategory(category: string): BoardEntry[] {
    return this.load().filter((e) => (e.category ?? "").trim() === category);
  }

  add(scope: string, name: string, value: string, vtype: string, category: string, owner: string, description: string, sessionId?: string): string {
    if (value.length > MAX_VALUE_LENGTH) throw new Error(`值超过 ${MAX_VALUE_LENGTH} 字限制（当前 ${value.length} 字）`);
    const entries = this.load();
    if (findIndex(entries, scope, name) >= 0) throw new Error(`'${scope}:${name}' 已存在，请用 replace 或 edit`);

    const now = nowTs();
    entries.push({ scope, name, value, type: vtype, category, owner, description, sessionId: scope === "session" ? sessionId : undefined, created_at: now, updated_at: now });
    this.save(entries);
    return `<board>${scope}:${name} 已创建</board>`;
  }

  replace(scope: string, name: string, value: string | null, vtype: string | null, category: string | null, owner: string | null, description: string | null): string {
    if (value !== null && value.length > MAX_VALUE_LENGTH) throw new Error(`值超过 ${MAX_VALUE_LENGTH} 字限制`);
    const entries = this.load();
    const idx = findIndex(entries, scope, name);

    if (idx < 0) {
      const now = nowTs();
      entries.push({ scope, name, value: value ?? "", type: vtype ?? "", category: category ?? "", owner: owner ?? "", description: description ?? "", created_at: now, updated_at: now });
      this.save(entries);
      return `'${scope}:${name}' 已创建（replace → 新建）`;
    }

    const existing = entries[idx];
    const newValue = value ?? existing.value;
    const newVtype = vtype ?? existing.type;
    const newCat = category ?? existing.category;
    const newOwner = owner ?? existing.owner;
    const newDesc = description ?? existing.description;

    if (!newValue.trim() && !newCat.trim() && !newDesc.trim()) {
      entries.splice(idx, 1);
      this.save(entries);
      return `<board>${scope}:${name} 已删除</board>`;
    }

    if (newValue === existing.value && newVtype === existing.type && newCat === existing.category && newOwner === existing.owner && newDesc === existing.description) {
      return `<board>${scope}:${name} 当前没有更新的内容</board>`;
    }

    existing.value = newValue;
    existing.type = newVtype;
    existing.category = newCat;
    existing.owner = newOwner;
    existing.description = newDesc;
    existing.updated_at = nowTs();
    this.save(entries);
    return `<board>${scope}:${name} 已覆盖</board>`;
  }

  edit(scope: string, name: string, value: string | null, vtype: string | null, category: string | null, owner: string | null, description: string | null): string {
    if (value !== null && value.length > MAX_VALUE_LENGTH) throw new Error(`值超过 ${MAX_VALUE_LENGTH} 字限制`);
    const entries = this.load();
    const idx = findIndex(entries, scope, name);
    if (idx < 0) throw new Error(`'${scope}:${name}' 不存在，无法编辑`);

    const existing = entries[idx];
    let changed = false;
    if (value !== null && value !== existing.value) { existing.value = value; changed = true; }
    if (vtype !== null && vtype !== existing.type) { existing.type = vtype; changed = true; }
    if (category !== null && category !== existing.category) { existing.category = category; changed = true; }
    if (owner !== null && owner !== existing.owner) { existing.owner = owner; changed = true; }
    if (description !== null && description !== existing.description) { existing.description = description; changed = true; }

    if (!changed) return `<board>${scope}:${name} 当前没有更新的内容</board>`;
    existing.updated_at = nowTs();
    this.save(entries);
    return `<board>${scope}:${name} 已更新</board>`;
  }

  delete(scope: string, name: string): string {
    const entries = this.load();
    const idx = findIndex(entries, scope, name);
    if (idx < 0) throw new Error(`'${scope}:${name}' 不存在`);
    entries.splice(idx, 1);
    this.save(entries);
    return `<board>${scope}:${name} 已删除</board>`;
  }
}

// store cache
const storeCache = new Map<string, BoardStore>();

function getStore(maouRoot: string): BoardStore {
  if (!storeCache.has(maouRoot)) storeCache.set(maouRoot, new BoardStore(maouRoot));
  return storeCache.get(maouRoot)!;
}

export class BoardTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "board",
    aliases: [],
    description:
      "共享状态看板（仅限结构化状态数据）。用于存储键值对形式的状态信息，如任务进度、计数器、角色属性、配置标记等。" +
      "action: list/get/add/replace/edit/del。值最长100字。" +
      "【禁止】不要用来存储对话摘要、聊天总结、用户消息内容、上下文记忆或任何自然语言段落。" +
      "【禁止】不要用 board 作为对话记忆或聊天历史工具。对话上下文由系统自动管理，不需要你手动存储。" +
      "只在需要持久化追踪的结构化状态时才使用（如：当前任务进度=第3步、用户偏好语言=中文、计数器=5）。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "add", "replace", "edit", "del"],
          description: "list: 列出全部 | get: 查单条或分类 | add: 新增 | replace: 覆盖/新建 | edit: 局部修改 | del: 删除",
        },
        scope: { type: "string", enum: ["session", "project", "global"], description: "作用域（默认 session）" },
        name: { type: "string", description: "键名" },
        value: { type: "string", description: "键值，最长100字符" },
        type: { type: "string", description: "数据类型（可选）" },
        category: { type: "string", description: "分类标签（可选）" },
        owner: { type: "string", description: "所属者（可选）" },
        description: { type: "string", description: "用途说明（可选）" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  /**
   * 会话开始时清理 session-scoped 条目
   * 注意：onSessionStart 早于 execute，_maouRoot 可能未初始化（race）。
   * 此处只在 _maouRoot 已知时清理；未初始化时跳过（execute 首次调用时会补清理），
   * 避免清理打到 cwd 错误路径。
   */
  onSessionStart(sessionId: string): void {
    if (!this._maouRoot) return; // 等 execute 首次调用设置 root 后再清
    const store = getStore(this._maouRoot);
    const cleared = store.clearSession(sessionId);
    if (cleared > 0) {
      // 仅用于日志，不阻塞
    }
  }

  private _maouRoot = "";
  private _cleanedSessions = new Set<string>();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    if (!VALID_ACTIONS.has(action)) return createToolResponse(false, `无效 action '${action}'，支持: ${[...VALID_ACTIONS].join(", ")}`);

    const scope = String(params.scope ?? "session").trim().toLowerCase();
    if (!VALID_SCOPES.has(scope)) return createToolResponse(false, `无效 scope '${scope}'，支持: ${[...VALID_SCOPES].join(", ")}`);

    const category = String(params.category ?? "").trim();
    const name = String(params.name ?? "").trim();
    if (action !== "list" && action !== "get" && !name) return createToolResponse(false, "action 为 add/replace/edit/del 时 name 必填");

    // 设置 maouRoot（用 sandboxRoot/workingDir，与 store 实际写入路径一致）
    if (!this._maouRoot) this._maouRoot = ctx.sandboxRoot || ctx.workingDir || ctx.projectRoot;
    // 补 onSessionStart 跳过的清理（首帧）
    if (ctx.sessionId && !this._cleanedSessions.has(ctx.sessionId)) {
      this._cleanedSessions.add(ctx.sessionId);
      getStore(this._maouRoot).clearSession(ctx.sessionId);
    }

    const store = getStore(ctx.sandboxRoot || ctx.workingDir);

    try {
      if (action === "list") {
        const entries = store.listAll();
        if (entries.length === 0) return createToolResponse(true, "<board>暂无条目</board>");
        const items = entries.map((e) => `${e.scope}:${e.name}=${e.value}`);
        return createToolResponse(true, `<board>${items.join(", ")}</board>`);
      }

      if (action === "get") {
        if (name) {
          const entry = store.get(scope, name);
          if (!entry) return createToolResponse(true, `'${scope}:${name}' 不存在`);
          return createToolResponse(true, "```json\n" + JSON.stringify(entry, null, 2) + "\n```");
        }
        if (category) {
          const entries = store.getByCategory(category);
          if (entries.length === 0) return createToolResponse(true, `分类 '${category}' 下无条目`);
          return createToolResponse(true, formatMdTable(entries));
        }
        return createToolResponse(false, "get 需要提供 name 或 category 参数");
      }

      if (action === "add") {
        const value = String(params.value ?? "").trim();
        if (!value) return createToolResponse(false, "add 需要提供 value");
        const vtype = String(params.type ?? "").trim();
        const owner = String(params.owner ?? "").trim();
        const desc = String(params.description ?? "").trim();
        const msg = store.add(scope, name, value, vtype, category, owner, desc, ctx.sessionId);
        return createToolResponse(true, msg);
      }

      if (action === "replace") {
        const value = params.value != null ? String(params.value).trim() : null;
        const vtype = params.type != null ? String(params.type).trim() : null;
        const owner = params.owner != null ? String(params.owner).trim() : null;
        const desc = params.description != null ? String(params.description).trim() : null;
        const msg = store.replace(scope, name, value, vtype, category || null, owner, desc);
        return createToolResponse(true, msg);
      }

      if (action === "edit") {
        const value = params.value != null ? String(params.value).trim() : null;
        const vtype = params.type != null ? String(params.type).trim() : null;
        const owner = params.owner != null ? String(params.owner).trim() : null;
        const desc = params.description != null ? String(params.description).trim() : null;
        const msg = store.edit(scope, name, value, vtype, category || null, owner, desc);
        return createToolResponse(true, msg);
      }

      if (action === "del") {
        const msg = store.delete(scope, name);
        return createToolResponse(true, msg);
      }

      return createToolResponse(false, `未知 action: ${action}`);
    } catch (err) {
      return createToolResponse(false, err instanceof Error ? err.message : String(err));
    }
  }
}
