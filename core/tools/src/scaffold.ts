/**
 * toolinit —— 工具脚手架生成器。
 *
 * 生成旧式 Tool 三件（tool.ts + schema.json + TOOL.md），与现有内置工具
 * （reader/grep 等）一致，能被 DynamicToolLoader 自动扫描注册。
 *
 * 用法：createToolScaffold("my_tool", "./tools/my_tool")
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ScaffoldOptions {
  /** 工具描述（写进 schema.json + tool.ts 注释）。 */
  description?: string;
  /** 已存在时是否强制覆盖（默认 false，幂等跳过）。 */
  force?: boolean;
}

/**
 * 生成旧式工具骨架三件到 targetDir：
 *   - tool.ts     extends Tool + schemaDir + 占位 definition/execute，export default new 实例
 *   - schema.json 占位 {name, description, parameters}
 *   - TOOL.md     使用指引占位
 *
 * 幂等：三件都存在且未 force 时直接返回 targetDir。
 * 返回生成的目录路径。
 */
export function createToolScaffold(
  name: string,
  targetDir: string,
  opts: ScaffoldOptions = {},
): string {
  const description = opts.description ?? `${name} 工具`;
  const force = opts.force ?? false;

  mkdirSync(targetDir, { recursive: true });

  const toolTsPath = join(targetDir, "tool.ts");
  const schemaJsonPath = join(targetDir, "schema.json");
  const toolMdPath = join(targetDir, "TOOL.md");

  // 幂等：三件都在且未 force → 跳过
  if (!force && existsSync(toolTsPath) && existsSync(schemaJsonPath) && existsSync(toolMdPath)) {
    return targetDir;
  }

  // tool.ts —— 旧式 Tool 骨架（参照 reader/god_tool/reader/tool.ts）
  // import 用包名而非相对路径：agent tools/ 目录里的工具位置不固定，包名解析最稳。
  const toolTs = `/**
 * ${name} — ${description}
 * 由 toolinit (createToolScaffold) 生成。在此实现工具逻辑。
 */

import { Tool, toolDir, createToolResponse } from "@little-house-studio/tools";
import type { ToolContext, ToolResponse, ToolDefinition } from "@little-house-studio/tools";

export class ${pascalCase(name)}Tool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);

  readonly definition: ToolDefinition = {
    name: "${name}",
    aliases: [],
    description: "${description}",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "输入参数" },
      },
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(
    params: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResponse> {
    const input = String(params.input ?? "");
    // TODO: 实现工具逻辑
    return createToolResponse(true, \`${name} 收到: \${input}\`);
  }
}

export default new ${pascalCase(name)}Tool();
`;

  // schema.json —— 占位（nativeToolSchemas 优先读它）
  const schemaJson = {
    name,
    description,
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "输入参数" },
      },
    },
  };

  // TOOL.md —— 使用指引占位
  const toolMd = `## 使用指引

- ${name}：${description}
- TODO: 补充使用指引。
`;

  writeFileSync(toolTsPath, toolTs, "utf-8");
  writeFileSync(schemaJsonPath, JSON.stringify(schemaJson, null, 2) + "\n", "utf-8");
  writeFileSync(toolMdPath, toolMd, "utf-8");

  return targetDir;
}

/** kebab/snake_case → PascalCase（类名用）。 */
function pascalCase(name: string): string {
  return name
    .split(/[-_/.]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}
