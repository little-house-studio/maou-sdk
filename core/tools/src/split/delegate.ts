/**
 * 上帝工具保留 + 独立动词入口：动词工具把固定字段注入后转调同一份实现。
 */

import { Tool } from "../base.js";
import type { JsonSchema, ToolContext, ToolDefinition, ToolResponse } from "../base.js";

export interface VerbSpec {
  name: string;
  aliases?: string[];
  description: string;
  /** 注入到上帝工具 params 的字段（通常是 action / mode / manage_action） */
  inject: Record<string, unknown>;
  /** 从上帝 schema 里去掉的字段（默认 action） */
  omit?: string[];
  allowedModes?: ToolDefinition["allowedModes"];
  parallelSafe?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 从上帝工具的对外 schema 继承参数，去掉分发字段。 */
export function inheritGodParams(god: Tool, omit: string[] = ["action"]): Record<string, unknown> {
  const native = god.nativeToolSchemas()[0];
  const root = asRecord(native) ?? {};
  const params = asRecord(root.parameters) ?? asRecord(god.definition.parameters) ?? {};
  const properties = { ...(asRecord(params.properties) ?? {}) };
  for (const key of omit) delete properties[key];
  const required = Array.isArray(params.required)
    ? params.required.filter((item) => typeof item === "string" && !omit.includes(item))
    : [];
  return {
    type: "object",
    properties,
    required,
    additionalProperties: params.additionalProperties === true,
  };
}

export class VerbTool extends Tool {
  readonly definition: ToolDefinition;

  constructor(
    private readonly god: Tool,
    spec: VerbSpec,
  ) {
    super();
    const omit = spec.omit ?? ["action"];
    this.definition = {
      name: spec.name,
      aliases: spec.aliases ?? [],
      description: spec.description,
      parameters: inheritGodParams(god, omit) as ToolDefinition["parameters"],
      allowedModes: spec.allowedModes ?? god.definition.allowedModes,
      parallelSafe: spec.parallelSafe ?? god.definition.parallelSafe,
    };
    this.inject = spec.inject;
  }

  private readonly inject: Record<string, unknown>;

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    return this.god.execute({ ...params, ...this.inject }, ctx);
  }
}

export function bindVerbs(god: Tool, specs: VerbSpec[]): Tool[] {
  return specs.map((spec) => new VerbTool(god, spec));
}

export function verbNames(specs: VerbSpec[]): string[] {
  return specs.map((spec) => spec.name);
}

export type { JsonSchema };
