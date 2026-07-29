/**
 * project_agent — Ops Agent 与项目 Coding Agent 的桥。
 *
 * 项目清单来自机器级 projects.json；项目任务复用 runtime 已有的
 * `kind: project` 子 Agent 执行链和 PathGuard，不经 localhost HTTP 服务。
 */

import { basename, isAbsolute, join, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  getProjectsList,
  registerProject,
  removeProjectByPath,
  resolveUserAgentsDir,
} from "@little-house-studio/types";
import { Tool, createToolResponse, resolveToolRuntimePorts, toolDir } from "../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../base.js";

const PROJECT_CODING_AGENT = "coding";

function resolveProject(selector: string, userRoot?: string) {
  const projects = getProjectsList(userRoot);
  const raw = selector.trim();
  if (!raw) return { projects } as const;
  let canonical = resolve(raw);
  try { canonical = realpathSync.native(canonical); } catch { /* missing path */ }
  const pathKey = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const exactPath = projects.find((p) => {
    const candidate = process.platform === "win32" ? p.path.toLowerCase() : p.path;
    return candidate === pathKey;
  });
  if (exactPath) return { projects, project: exactPath } as const;
  const byName = projects.filter((p) => p.name === raw);
  if (byName.length === 1) return { projects, project: byName[0] } as const;
  return { projects, matches: byName } as const;
}

/**
 * 在项目下驻扎 coding agent（幂等）。
 * 对齐 core/agent AgentRegistry.ensureProjectAgent 的引用模式，
 * 但不依赖 @little-house-studio/agent（tools 层禁止反向依赖）。
 */
function ensureProjectCodingAgent(
  projectPath: string,
  maouRoot?: string,
): { created: boolean; dir: string; reason: string } {
  const projectDir = join(projectPath, ".maou", "agents", PROJECT_CODING_AGENT);
  const agentJson = join(projectDir, "agent.json");
  const agentRef = join(projectDir, ".agent.ref");
  if (existsSync(agentRef) || existsSync(agentJson)) {
    return { created: false, dir: projectDir, reason: "项目级 agent 已存在" };
  }

  mkdirSync(projectDir, { recursive: true });

  const globalCoding = join(resolveUserAgentsDir(maouRoot), PROJECT_CODING_AGENT);
  const globalMain = join(resolveUserAgentsDir(maouRoot), "main");
  const hasGlobalCoding =
    existsSync(join(globalCoding, "agent.json")) || existsSync(join(globalCoding, ".agent.ref"));
  const hasGlobalMain =
    existsSync(join(globalMain, "agent.json")) || existsSync(join(globalMain, ".agent.ref"));

  if (hasGlobalCoding || hasGlobalMain) {
    const templateDir = hasGlobalCoding ? globalCoding : globalMain;
    writeFileSync(agentRef, templateDir, "utf-8");
    writeFileSync(
      join(projectDir, "agent.custom.json"),
      JSON.stringify({
        working_dir: projectPath,
        ...(hasGlobalCoding ? {} : { display_name: PROJECT_CODING_AGENT }),
      }, null, 2),
      "utf-8",
    );
    return {
      created: true,
      dir: projectDir,
      reason: hasGlobalCoding ? "引用全局 coding 模板" : "引用全局 main 模板",
    };
  }

  // 无全局模板时写最小骨架（与 DEFAULT_PROJECT_AGENT_TEMPLATE 对齐）
  const now = new Date().toISOString();
  const tools = [
    "reader", "write_file", "edit_file", "glob", "grep", "find_code",
    "use_terminal", "search_internet", "use_skill", "find_skill",
    "todo_manage", "todo_finish",
  ];
  writeFileSync(join(projectDir, "agent.json"), JSON.stringify({
    name: PROJECT_CODING_AGENT,
    display_name: "Coding Agent",
    status: "idle",
    role: "coding",
    scope: "project",
    description: "项目级编码助手（project_agent create 物化）",
    notes: "由 project_agent create 物化；可自由编辑，不会被覆盖。",
    round_limit: 50,
    tools,
    tool_compression: "normal",
    working_dir: projectPath,
    created_at: now,
    updated_at: now,
  }, null, 2), "utf-8");
  const promptDir = join(projectDir, "prompt", "system");
  mkdirSync(promptDir, { recursive: true });
  writeFileSync(
    join(promptDir, "system.md"),
    "# 编程 Agent\n\n你是一个驻扎在项目目录里的编程 agent。\n",
    "utf-8",
  );
  writeFileSync(
    join(projectDir, "PERMISSION.jsonc"),
    JSON.stringify({ permission_preset: "full", tool_whitelist: tools }, null, 2),
    "utf-8",
  );
  return { created: true, dir: projectDir, reason: "内置默认模板" };
}

export class ProjectAgentTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "project_agent",
    aliases: [],
    description:
      "Ops Agent 的项目代理工具。list 项目清单；create 注册并驻扎；send 派任务；" +
      "repair 修复失效标记/agent；rebind 把注册项绑到新路径。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "send", "repair", "rebind"],
          description:
            "list=清单；create=注册路径+驻扎 Agent；send=派任务；" +
            "repair=修复 .maou 标记与 coding agent；rebind=更新注册路径。",
        },
        project: {
          type: "string",
          description: "项目绝对路径或唯一项目名。重名时必须传绝对路径。",
        },
        path: {
          type: "string",
          description: "create/repair/rebind 的项目绝对路径（rebind 时为新路径）。",
        },
        task: {
          type: "string",
          description: "send 时发给项目 Agent 的完整任务说明。",
        },
        name: {
          type: "string",
          description: "项目显示名；create/rebind 时可选。",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    if (action === "list") return this.list(ctx);
    if (action === "create") return this.create(params, ctx);
    if (action === "send") return this.send(params, ctx);
    if (action === "repair") return this.repair(params, ctx);
    if (action === "rebind") return this.rebind(params, ctx);
    return createToolResponse(
      false,
      `不支持的 action: ${action}。支持: list / create / send / repair / rebind`,
    );
  }

  private list(ctx: ToolContext): ToolResponse {
    const projects = getProjectsList(ctx.maouRoot);
    if (projects.length === 0) {
      return createToolResponse(
        true,
        "尚无 Coding 项目。用户在项目目录运行 `maou coding` 后会自动注册。",
        { payload: { projects: [] } },
      );
    }
    const lines = ["Maou Coding 项目", ""];
    for (const p of projects) {
      lines.push(`- ${p.isActive ? "●" : "○"} ${p.name}: ${p.path}${p.isActive ? "" : "（路径或 .maou 标记失效）"}`);
    }
    return createToolResponse(true, lines.join("\n"), { payload: { projects } });
  }

  private create(params: Record<string, unknown>, ctx: ToolContext): ToolResponse {
    const rawPath = String(params.path ?? params.project ?? "").trim();
    if (!rawPath) return createToolResponse(false, "create 需要 path（项目绝对路径）。");
    if (!isAbsolute(rawPath)) {
      return createToolResponse(false, `create 需要绝对路径，收到相对路径: ${rawPath}`);
    }
    const path = resolve(rawPath);
    if (!existsSync(path)) return createToolResponse(false, `项目路径不存在: ${path}`);
    try {
      if (!statSync(path).isDirectory()) {
        return createToolResponse(false, `项目路径不是目录: ${path}`);
      }
    } catch {
      return createToolResponse(false, `无法访问项目路径: ${path}`);
    }

    const projectDir = join(path, ".maou");
    const marker = join(projectDir, "project.json");
    if (!existsSync(marker)) {
      mkdirSync(join(projectDir, "sessions"), { recursive: true });
      writeFileSync(marker, JSON.stringify({
        version: 1,
        cwd: path,
        createdAt: new Date().toISOString(),
        product: "coding-agent",
      }, null, 2), "utf-8");
    }

    const agent = ensureProjectCodingAgent(path, ctx.maouRoot);

    const entry = registerProject(path, {
      name: String(params.name ?? "").trim() || basename(path),
      product: "coding-agent",
      userRoot: ctx.maouRoot,
    });
    return createToolResponse(
      true,
      [
        `已创建并注册项目 Agent：${entry.name}`,
        entry.path,
        agent.created
          ? `coding agent 已驻扎 → ${agent.dir}（${agent.reason}）`
          : `coding agent 已存在 → ${agent.dir}`,
      ].join("\n"),
      { payload: { project: entry, agent } },
    );
  }

  private async send(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const selector = String(params.project ?? params.path ?? "").trim();
    const task = String(params.task ?? "").trim();
    if (!selector) return createToolResponse(false, "send 需要 project（绝对路径或唯一项目名）。");
    if (!task) return createToolResponse(false, "send 需要 task（完整任务说明）。");

    const resolved = resolveProject(selector, ctx.maouRoot);
    if (!resolved.project) {
      if (resolved.matches && resolved.matches.length > 1) {
        return createToolResponse(
          false,
          `项目名「${selector}」不唯一，请传绝对路径：\n${resolved.matches.map((p) => `- ${p.path}`).join("\n")}`,
        );
      }
      return createToolResponse(false, `未找到项目「${selector}」。先运行 project_agent list 或 create。`);
    }
    if (!resolved.project.isActive) {
      return createToolResponse(
        false,
        `项目不可用或缺少 .maou/project.json: ${resolved.project.path}\n` +
          `可先 project_agent repair path="${resolved.project.path}" 再 send。`,
      );
    }

    const executor = resolveToolRuntimePorts(ctx).subagentExecutor;
    if (!executor) return createToolResponse(false, "项目 Agent 执行器未注入。");

    const taskId = `project-${resolved.project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now().toString(36)}`;
    try {
      const result = await executor.fork(taskId, task, {
        kind: "project",
        agentName: "coding",
        path: resolved.project.path,
        persistContext: true,
        enableLoop: true,
        toolPreset: "coding_scoped",
      });
      return createToolResponse(result.ok, [
        `${result.ok ? "✅" : "❌"} 项目 Agent「${resolved.project.name}」任务完成`,
        `path: ${resolved.project.path}`,
        `session: ${result.subSessionId}`,
        result.error ? `error: ${result.error}` : "",
        "── 输出 ──",
        result.output || "(无输出)",
      ].filter(Boolean).join("\n"), {
        payload: { project: resolved.project, result },
      });
    } catch (error) {
      return createToolResponse(false, `项目 Agent 执行失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 修复失效项目：重建 .maou/project.json、驻扎 coding agent、刷新 registry。
   */
  private repair(params: Record<string, unknown>, ctx: ToolContext): ToolResponse {
    const selector = String(params.path ?? params.project ?? "").trim();
    if (!selector) {
      return createToolResponse(
        false,
        "repair 需要 path 或 project（绝对路径或已注册项目名）。",
      );
    }

    let path: string;
    const resolved = resolveProject(selector, ctx.maouRoot);
    if (resolved.project) {
      path = resolved.project.path;
    } else if (isAbsolute(selector)) {
      path = resolve(selector);
    } else if (resolved.matches && resolved.matches.length > 1) {
      return createToolResponse(
        false,
        `项目名「${selector}」不唯一，请传绝对路径：\n${resolved.matches.map((p) => `- ${p.path}`).join("\n")}`,
      );
    } else {
      return createToolResponse(
        false,
        `未找到项目「${selector}」。可用绝对路径 repair，或先 create。`,
      );
    }

    if (!existsSync(path)) {
      return createToolResponse(
        false,
        `路径不存在: ${path}\n若项目已搬家，请用 rebind name=… path=/新路径`,
      );
    }
    try {
      if (!statSync(path).isDirectory()) {
        return createToolResponse(false, `不是目录: ${path}`);
      }
    } catch {
      return createToolResponse(false, `无法访问: ${path}`);
    }

    const steps: string[] = [];
    const projectDir = join(path, ".maou");
    const marker = join(projectDir, "project.json");
    if (!existsSync(marker)) {
      mkdirSync(join(projectDir, "sessions"), { recursive: true });
      writeFileSync(
        marker,
        JSON.stringify(
          {
            version: 1,
            cwd: path,
            createdAt: new Date().toISOString(),
            product: "coding-agent",
            repairedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf-8",
      );
      steps.push("已重建 .maou/project.json");
    } else {
      steps.push(".maou/project.json 已存在");
    }

    const agent = ensureProjectCodingAgent(path, ctx.maouRoot);
    steps.push(
      agent.created
        ? `coding agent 已驻扎 → ${agent.dir}（${agent.reason}）`
        : `coding agent 已存在 → ${agent.dir}`,
    );

    const name =
      String(params.name ?? "").trim() ||
      resolved.project?.name ||
      basename(path);
    const entry = registerProject(path, {
      name,
      product: "coding-agent",
      userRoot: ctx.maouRoot,
    });
    steps.push(`已注册/刷新: ${entry.name} → ${entry.path}`);

    return createToolResponse(
      true,
      [`✅ 项目已修复：${entry.name}`, entry.path, ...steps.map((s) => `- ${s}`)].join(
        "\n",
      ),
      { payload: { project: entry, agent, steps } },
    );
  }

  /**
   * 重新绑定：把已注册项目名指到新绝对路径（目录须存在），并 repair 标记。
   */
  private rebind(params: Record<string, unknown>, ctx: ToolContext): ToolResponse {
    const newPathRaw = String(params.path ?? "").trim();
    const nameOrOld = String(params.project ?? params.name ?? "").trim();
    if (!newPathRaw || !isAbsolute(newPathRaw)) {
      return createToolResponse(
        false,
        "rebind 需要 path=新绝对路径，以及 project 或 name=原项目名/旧路径。",
      );
    }
    if (!nameOrOld) {
      return createToolResponse(
        false,
        "rebind 需要 project 或 name（要改绑的注册项）。",
      );
    }

    const newPath = resolve(newPathRaw);
    if (!existsSync(newPath) || !statSync(newPath).isDirectory()) {
      return createToolResponse(false, `新路径无效: ${newPath}`);
    }

    const resolved = resolveProject(nameOrOld, ctx.maouRoot);
    const displayName =
      String(params.name ?? "").trim() ||
      resolved.project?.name ||
      basename(newPath);
    const oldPath = resolved.project?.path;

    if (oldPath && !pathKeysEqual(oldPath, newPath)) {
      removeProjectByPath(oldPath, ctx.maouRoot);
    }

    const projectDir = join(newPath, ".maou");
    const marker = join(projectDir, "project.json");
    if (!existsSync(marker)) {
      mkdirSync(join(projectDir, "sessions"), { recursive: true });
      writeFileSync(
        marker,
        JSON.stringify(
          {
            version: 1,
            cwd: newPath,
            createdAt: new Date().toISOString(),
            product: "coding-agent",
            reboundFrom: oldPath ?? null,
          },
          null,
          2,
        ),
        "utf-8",
      );
    }
    const agent = ensureProjectCodingAgent(newPath, ctx.maouRoot);
    const entry = registerProject(newPath, {
      name: displayName,
      product: "coding-agent",
      userRoot: ctx.maouRoot,
    });
    return createToolResponse(
      true,
      [
        `✅ 已 rebind：${entry.name}`,
        oldPath && !pathKeysEqual(oldPath, newPath) ? `旧路径: ${oldPath}` : "",
        `新路径: ${entry.path}`,
        agent.created
          ? `coding agent 已驻扎 → ${agent.dir}`
          : `coding agent 已存在 → ${agent.dir}`,
      ]
        .filter(Boolean)
        .join("\n"),
      { payload: { project: entry, oldPath, agent } },
    );
  }
}

function pathKeysEqual(a: string, b: string): boolean {
  const norm = (p: string) =>
    process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
  return norm(a) === norm(b);
}
