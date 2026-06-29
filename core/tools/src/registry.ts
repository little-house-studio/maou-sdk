/**
 * Tool Registry
 * Python equivalent: core/tools/registry.py
 *
 * Schema 来源：每个 Tool 实例通过 schemaDir 自带 schema.json + TOOL.md
 * Tool.nativeToolSchemas() 优先从 schemaDir/schema.json 读取
 *
 * Whitelist format: category/subpath (e.g. "terminal/use_terminal", "agent_team/god_tool/agent_team")
 */

import { readFileSync, existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolDefinition, ToolContext, ToolResponse } from "./base.js";
import { createToolResponse } from "./base.js";
import { clearReadRegistry } from "./file/read-registry.js";
import { clearHistory as clearFileEditHistory } from "./file/file-edit-history.js";

/** Schema with source path for whitelist matching */
interface SchemaWithPath {
  schema: JsonSchema;
  path: string; // relative path from schemasDir, e.g. "terminal/use_terminal"
}

export class ToolRegistry {
  private _tools = new Map<string, Tool>();
  /** Agent 级工具目录（文件即 Agent 约定） */
  private _agentToolsDirs: string[] = [];
  /** TOOL.md 缓存：toolName → { content, mtimeMs } */
  private _toolPromptCache = new Map<string, { content: string; mtimeMs: number }>();
  /** TOOL.md 文件监听器 */
  private _toolPromptWatchers: FSWatcher[] = [];
  /** 缓存是否已失效（文件变更后置 true，下次 getToolPrompts 时重建） */
  private _toolPromptCacheDirty = false;

  /**
   * 添加 Agent 级工具目录（如 ~/.maou/agents/<name>/tools/）
   * 目录下的 schema.json 文件会被自动发现并合并到工具列表
   */
  addAgentToolsDir(dir: string): void {
    if (existsSync(dir) && !this._agentToolsDirs.includes(dir)) {
      this._agentToolsDirs.push(dir);
    }
  }

  /**
   * 清空 Agent 级工具目录
   */
  clearAgentToolsDirs(): void {
    this._agentToolsDirs = [];
  }

  /**
   * Register a tool (with aliases)
   */
  register(tool: Tool): void {
    this._tools.set(tool.definition.name, tool);
    for (const alias of tool.definition.aliases) {
      this._tools.set(alias, tool);
    }
  }

  /**
   * Get tool by name or alias
   */
  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  /**
   * List all tool definitions (deduplicated)
   */
  list(): ToolDefinition[] {
    const seen = new Set<number>();
    const definitions: ToolDefinition[] = [];
    for (const tool of this._tools.values()) {
      const id = getObjectUid(tool);
      if (seen.has(id)) continue;
      seen.add(id);
      definitions.push(tool.definition);
    }
    return definitions;
  }

  /**
   * Call session cleanup hooks on all tools
   *
   * 在新 session 启动前清理上一次 session 的工具侧状态：
   * 1. 调用每个工具的 onSessionStart 钩子（工具自身的 session-scoped 状态）
   * 2. 清空 read-registry（避免读到旧 session 的「文件已读」假标记，让下次 reader 工具重新读盘）
   * 3. 清空 file-edit-history（避免 undo 误把上一个 session 的编辑回退掉）
   *
   * 注意：sessionId 在 maou 里通常是唯一 UUID，理论上不会撞——但 task recovery / 复用同名 session
   * 时仍可能命中旧 state。冗余清理无副作用，所以这里都调一遍。
   */
  cleanupSession(sessionId: string): number {
    const seen = new Set<number>();
    let count = 0;
    for (const tool of this._tools.values()) {
      const id = getObjectUid(tool);
      if (seen.has(id)) continue;
      seen.add(id);
      if (tool.onSessionStart) {
        try {
          tool.onSessionStart(sessionId);
          count++;
        } catch { /* ignore */ }
      }
    }
    // 清空模块级 session-scoped 状态（read-registry + file-edit-history）
    try { clearReadRegistry(sessionId); } catch { /* ignore */ }
    try { clearFileEditHistory(sessionId); } catch { /* ignore */ }
    return count;
  }

  /**
   * 获取白名单中启用工具的提示词（TOOL.md），用于注入 system prompt
   * 使用缓存 + 文件监听：首次读取后缓存，文件变更时标记 dirty，下次调用重建
   * @param whitelist 工具白名单，undefined 表示全部
   * @returns Map<toolName, promptText>
   */
  getToolPrompts(whitelist?: Set<string>): Map<string, string> {
    const prompts = new Map<string, string>();
    const allowAll = whitelist?.has("*");
    const effectiveWhitelist = allowAll ? undefined : whitelist;
    const seen = new Set<number>();

    for (const tool of this._tools.values()) {
      const id = getObjectUid(tool);
      if (seen.has(id)) continue;
      seen.add(id);

      const name = tool.definition.name;
      // 白名单过滤
      if (effectiveWhitelist && !effectiveWhitelist.has(name)) {
        const aliases: string[] = tool.definition.aliases ?? [];
        if (!aliases.some(a => effectiveWhitelist!.has(a))) {
          continue;
        }
      }

      const prompt = this._readToolPromptCached(tool);
      if (prompt) {
        prompts.set(name, prompt);
      }
    }
    // 重建完成：清 dirty 标志（下次文件变化再置 true 触发重建）
    this._toolPromptCacheDirty = false;
    return prompts;
  }

  /** 读取工具提示词（带缓存：mtime 未变则返回缓存，避免每轮全量重读） */
  private _readToolPromptCached(tool: Tool): string | null {
    if (!tool.schemaDir) return null;
    const promptPath = join(tool.schemaDir, "TOOL.md");

    const fileExists = existsSync(promptPath);
    if (!fileExists) {
      this._toolPromptCache.delete(tool.definition.name);
      return null;
    }

    // 缓存快路径：比对文件真实 mtime，未变且未 dirty 则直接返回缓存
    try {
      const stat = statSync(promptPath);
      const cached = this._toolPromptCache.get(tool.definition.name);
      if (cached && !this._toolPromptCacheDirty && cached.mtimeMs === stat.mtimeMs) {
        return cached.content;
      }

      const content = readFileSync(promptPath, "utf-8");
      if (!content.trim()) {
        this._toolPromptCache.delete(tool.definition.name);
        return null;
      }
      this._toolPromptCache.set(tool.definition.name, { content, mtimeMs: stat.mtimeMs });
      return content;
    } catch {
      return null;
    }
  }

  /**
   * 启动 TOOL.md 文件监听（热编译）
   * 文件变更时标记缓存 dirty，下次 getToolPrompts 调用自动重建
   */
  startToolPromptWatch(): void {
    // 先关闭已有监听
    this.stopToolPromptWatch();

    const watchedDirs = new Set<string>();
    for (const tool of this._tools.values()) {
      if (tool.schemaDir && !watchedDirs.has(tool.schemaDir)) {
        watchedDirs.add(tool.schemaDir);
        try {
          const watcher = watch(tool.schemaDir, { persistent: false }, (eventType, filename) => {
            if (filename && /^TOOL\.md$/i.test(filename)) {
              this._toolPromptCacheDirty = true;
              // 清除该工具的缓存条目
              const toolName = tool.definition.name;
              this._toolPromptCache.delete(toolName);
            }
          });
          this._toolPromptWatchers.push(watcher);
        } catch { /* 监听失败不影响功能 */ }
      }
    }
  }

  /** 停止 TOOL.md 文件监听 */
  stopToolPromptWatch(): void {
    for (const w of this._toolPromptWatchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this._toolPromptWatchers = [];
  }

  /**
   * Get native tool schemas for LLM
   * @param whitelist optional whitelist of path patterns (e.g. "terminal/use_terminal")
   *                   "*" means all allowed
   *
   * Priority: agent tools dirs > Tool class (自带 schema.json)
   */
  nativeToolSchemas(whitelist?: Set<string>): JsonSchema[] {
    const schemas: JsonSchema[] = [];
    const seenNames = new Set<string>();

    // Check if whitelist has "*" (all allowed)
    const allowAll = whitelist?.has("*");
    const effectiveWhitelist = allowAll ? undefined : whitelist;

    // 1. Load from agent tools directories (文件即 Agent 约定)
    for (const agentDir of this._agentToolsDirs) {
      const agentSchemas = this._loadSchemasFromDir(agentDir);
      for (const item of agentSchemas) {
        const name = String(item.schema.name ?? "").trim();
        if (!name || seenNames.has(name)) continue;
        if (effectiveWhitelist && !this._matchesWhitelist(item.path, name, effectiveWhitelist)) continue;
        seenNames.add(name);
        schemas.push(item.schema);
      }
    }

    // 2. Fallback to registered tool definitions
    const seenTools = new Set<number>();
    for (const tool of this._tools.values()) {
      const toolId = getObjectUid(tool);
      if (seenTools.has(toolId)) continue;
      seenTools.add(toolId);
      for (const schema of tool.nativeToolSchemas()) {
        const name = String((schema as any).name ?? "").trim();
        if (!name || seenNames.has(name)) continue;
        if (effectiveWhitelist && !effectiveWhitelist.has(name)) {
          const aliases: string[] = tool.definition.aliases ?? [];
          if (!aliases.some(a => effectiveWhitelist!.has(a))) continue;
        }
        seenNames.add(name);
        schemas.push(schema);
      }
    }

    return schemas;
  }

  /**
   * Check if a schema matches the whitelist
   * Matches by: path pattern (e.g. "terminal/use_terminal") or tool name
   */
  private _matchesWhitelist(path: string, name: string, whitelist: Set<string>): boolean {
    // Direct path match
    if (whitelist.has(path)) return true;
    // Direct name match (backward compatible)
    if (whitelist.has(name)) return true;
    // Prefix match: "terminal/*" matches all terminal tools
    for (const pattern of whitelist) {
      if (pattern.endsWith("/*") && path.startsWith(pattern.slice(0, -2))) return true;
      if (pattern.endsWith("/") && path.startsWith(pattern)) return true;
    }
    return false;
  }

  /**
   * Recursively load schemas from directory
   * Returns schemas with their relative paths for whitelist matching
   */
  private _loadSchemasFromDir(dir: string): SchemaWithPath[] {
    const schemas: SchemaWithPath[] = [];
    if (!existsSync(dir)) return schemas;

    this._scanDirRecursive(dir, "", schemas);
    return schemas;
  }

  /**
   * Recursive directory scanner
   * @param dir current directory to scan
   * @param relPath relative path from schemasDir (e.g. "terminal/use_terminal")
   * @param schemas accumulator for found schemas
   */
  private _scanDirRecursive(dir: string, relPath: string, schemas: SchemaWithPath[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        // Recurse into subdirectory
        const subRelPath = relPath ? `${relPath}/${entry}` : entry;
        this._scanDirRecursive(fullPath, subRelPath, schemas);
      } else if (entry === "schema.json") {
        // Found schema.json - path is the parent directory
        try {
          const text = readFileSync(fullPath, "utf-8");
          const data = JSON.parse(text);
          // Path is the directory containing schema.json (not including schema.json itself)
          // e.g. "terminal/use_terminal" for core/tools/terminal/use_terminal/schema.json
          const schemaPath = relPath || ".";
          if (Array.isArray(data)) {
            for (const s of data) {
              schemas.push({ schema: s, path: schemaPath });
            }
          } else if (data && typeof data === "object") {
            schemas.push({ schema: data, path: schemaPath });
          }
        } catch {
          // Skip malformed schema
        }
      }
    }
  }

  /**
   * Load schemas from TOOL.jsonc file (backward compatible)
   */
  /**
   * Execute tool by name
   */
  execute(
    toolCall: { name: string; parameters?: Record<string, unknown> },
    context: ToolContext,
  ): ToolResponse {
    const { name } = toolCall;
    const tool = this.get(name);
    if (!tool) {
      return createToolResponse(false, `Unknown tool: ${name}`);
    }
    if (
      tool.definition.allowedModes !== null &&
      !tool.definition.allowedModes.includes(context.agentMode)
    ) {
      return createToolResponse(
        false,
        `Tool '${name}' not available in ${context.agentMode} mode`,
      );
    }
    const parameters = { ...toolCall.parameters, __tool_name__: name };
    return createToolResponse(false, "Use async ToolExecutor instead");
  }
}

/** JsonSchema shorthand */
interface JsonSchema {
  name?: string;
  [key: string]: unknown;
}

/** Simple object UID via WeakMap */
const _uidMap = new WeakMap<object, number>();
let _uidCounter = 0;
function getObjectUid(obj: object): number {
  let uid = _uidMap.get(obj);
  if (uid === undefined) {
    uid = ++_uidCounter;
    _uidMap.set(obj, uid);
  }
  return uid;
}