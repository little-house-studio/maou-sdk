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
      "Ops Agent 的项目代理。list 清单；create 绑定已有路径并驻扎；send 派任务。" +
      "路径已有 .maou 时 create 只重新挂上，不初始化。失效项目在 list / send 结果里写清怎么用 create 修。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "send"],
          description: "list=清单；create=绑定路径+驻扎 Agent；send=派任务。",
        },
        project: {
          type: "string",
          description: "项目绝对路径或唯一项目名。重名时必须传绝对路径。",
        },
        path: {
          type: "string",
          description: "create 的项目绝对路径。",
        },
        task: {
          type: "string",
          description: "send 时发给项目 Agent 的完整任务说明。",
        },
        name: {
          type: "string",
          description: "项目显示名；create 时可选。同名已注册到别的路径时，改绑到这个路径。",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    if (action === "list") return this.list(ctx);
    if (action === "create") return this.create(params, ctx);
    if (action === "send") return this.send(params, ctx);
    if (action === "repair" || action === "rebind") {
      return createToolResponse(
        false,
        `${action} 已取消。对现在的绝对路径用 create 绑定即可。` +
          `目录里若已有 .maou，不会初始化，只重新挂上。先 list 看失效项说明。`,
      );
    }
    return createToolResponse(false, `不支持的 action: ${action}。支持: list / create / send`);
  }

  private list(ctx: ToolContext): ToolResponse {
    const projects = getProjectsList(ctx.maouRoot);
    if (projects.length === 0) {
      return createToolResponse(
        true,
        "尚无 Coding 项目。对已有目录用 create path=绝对路径 绑定；用户在项目目录运行 `maou coding` 也会自动注册。",
        { payload: { projects: [] } },
      );
    }
    const lines = ["Maou Coding 项目", ""];
    const diagnosed = projects.map((p) => ({ ...p, ...diagnoseProject(p.path) }));
    for (const p of diagnosed) {
      const stamp = p.updated_at ? `  上次更新: ${p.updated_at}` : "";
      if (p.status === "ok") {
        lines.push(`- ● ${p.name}: ${p.path}${stamp}`);
        continue;
      }
      lines.push(`- ○ ${p.name}: ${p.path}${stamp}`);
      lines.push(`  ${p.detail}`);
      lines.push(`  ${bindHint(p.path)}`);
    }
    return createToolResponse(true, lines.join("\n"), { payload: { projects: diagnosed } });
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
    const hadMarker = existsSync(marker);
    if (!hadMarker) {
      mkdirSync(join(projectDir, "sessions"), { recursive: true });
      writeFileSync(marker, JSON.stringify({
        version: 1,
        cwd: path,
        createdAt: new Date().toISOString(),
        product: "coding-agent",
      }, null, 2), "utf-8");
    }

    const displayName = String(params.name ?? "").trim();
    if (displayName) {
      for (const old of getProjectsList(ctx.maouRoot).filter((item) => item.name === displayName)) {
        if (!pathKeysEqual(old.path, path)) {
          removeProjectByPath(old.path, ctx.maouRoot);
        }
      }
    }

    const agent = ensureProjectCodingAgent(path, ctx.maouRoot);

    const entry = registerProject(path, {
      name: displayName || basename(path),
      product: "coding-agent",
      userRoot: ctx.maouRoot,
    });
    return createToolResponse(
      true,
      [
        hadMarker
          ? `已绑定项目（未初始化 .maou）：${entry.name}`
          : `已绑定并写入 .maou：${entry.name}`,
        entry.path,
        agent.created
          ? `coding agent 已驻扎 → ${agent.dir}（${agent.reason}）`
          : `coding agent 已存在 → ${agent.dir}`,
      ].join("\n"),
      { payload: { project: entry, agent, initialized: !hadMarker } },
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
      return createToolResponse(
        false,
        `未找到项目「${selector}」。先 project_agent list，或对已有目录 create path=绝对路径 绑定。`,
      );
    }
    const diagnosed = diagnoseProject(resolved.project.path);
    if (diagnosed.status !== "ok") {
      return createToolResponse(
        false,
        `项目「${resolved.project.name}」现在不能派任务。\n` +
          `${diagnosed.detail}\n${bindHint(resolved.project.path)}`,
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

}

function diagnoseProject(path: string): {
  status: "ok" | "missing_path" | "missing_marker";
  detail: string;
} {
  if (!existsSync(path)) {
    return { status: "missing_path", detail: "路径不存在（可能已搬家或被删）。" };
  }
  try {
    if (!statSync(path).isDirectory()) {
      return { status: "missing_path", detail: "路径不是目录。" };
    }
  } catch {
    return { status: "missing_path", detail: "无法访问该路径。" };
  }
  if (!existsSync(join(path, ".maou", "project.json"))) {
    return { status: "missing_marker", detail: "找不到 .maou/project.json。" };
  }
  return { status: "ok", detail: "" };
}

function bindHint(path: string): string {
  return `对该绝对路径调用 create path="${path}"。目录里若已有 .maou，不会初始化，只重新挂上。这条失效名单若不需要了，可 project_manage disband。`;
}

function pathKeysEqual(a: string, b: string): boolean {
  const norm = (p: string) =>
    process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
  return norm(a) === norm(b);
}
