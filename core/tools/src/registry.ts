/**
 * Tool Registry
 * Python equivalent: core/tools/registry.py
 *
 * Schema loading priority:
 * 1. Schema directory (recursive scan for schema.json) - highest
 * 2. Tool class definition - fallback
 *
 * Whitelist format: category/subpath (e.g. "terminal/use_terminal", "agent_team/god_tool/agent_team")
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Tool, ToolDefinition, ToolContext, ToolResponse } from "./base.js";
import { createToolResponse } from "./base.js";

/** Schema with source path for whitelist matching */
interface SchemaWithPath {
  schema: JsonSchema;
  path: string; // relative path from schemasDir, e.g. "terminal/use_terminal"
}

export class ToolRegistry {
  private _tools = new Map<string, Tool>();
  private _schemasDir: string | null = null;
  /** Agent 级工具目录（文件即 Agent 约定） */
  private _agentToolsDirs: string[] = [];

  /**
   * Set schema directory path (core/tools/)
   * Recursively scans for schema.json files
   */
  setSchemasDir(dir: string | null): void {
    this._schemasDir = dir;
  }

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
    return count;
  }

  /**
   * Get native tool schemas for LLM
   * @param whitelist optional whitelist of path patterns (e.g. "terminal/use_terminal")
   *                   "*" means all allowed
   *
   * Priority: schema dir > agent tools dirs > TOOL.jsonc > Tool class definition
   */
  nativeToolSchemas(whitelist?: Set<string>): JsonSchema[] {
    const schemas: JsonSchema[] = [];
    const seenNames = new Set<string>();

    // Check if whitelist has "*" (all allowed)
    const allowAll = whitelist?.has("*");
    const effectiveWhitelist = allowAll ? undefined : whitelist;

    // 1. Load from schema directory (highest priority)
    if (this._schemasDir) {
      const dirSchemas = this._loadSchemasFromDir();
      for (const item of dirSchemas) {
        const name = String(item.schema.name ?? "").trim();
        if (!name || seenNames.has(name)) continue;
        // Whitelist filter: match by path or by name
        if (effectiveWhitelist && !this._matchesWhitelist(item.path, name, effectiveWhitelist)) continue;
        seenNames.add(name);
        schemas.push(item.schema);
      }
    }

    // 2. Load from agent tools directories (文件即 Agent 约定)
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

    // 3. Fallback to registered tool definitions
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
  private _loadSchemasFromDir(dir?: string): SchemaWithPath[] {
    const schemas: SchemaWithPath[] = [];
    const scanDir = dir ?? this._schemasDir;
    if (!scanDir || !existsSync(scanDir)) return schemas;

    this._scanDirRecursive(scanDir, "", schemas);
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