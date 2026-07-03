/**
 * Find Skill 工具 — 搜索和安装远程 skill
 *
 * 两个模式：
 * - search: 搜索 skills.sh 上的 skill，按安装量排序
 * - install: 安装 skill 到本地 agent 目录
 */

import { exec as execAsync } from "node:child_process";
import { promisify } from "node:util";
const execAsyncP = promisify(execAsync);
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

// ─── 类型定义 ─────────────────────────────────────────────────────────────

interface SkillSearchResult {
  id: string;           // owner/repo@skill
  owner: string;
  repo: string;
  skill: string;
  name: string;
  installs: number;
  displayInstalls: string;
  description: string;
  url: string;
}

interface ParsedSearchQuery {
  keywords: string[];
  owner?: string;
  repo?: string;
  exact?: string;
}

// ─── 工具实现 ─────────────────────────────────────────────────────────────

export class FindSkillTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "find_skill",
    aliases: ["skill_search", "skill_install"],
    description:
      "Search or install skills from skills.sh registry. " +
      "Search mode returns top skills by install count. " +
      "Install mode downloads skill to local agent directory.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["search", "install"],
          description: "Action mode: 'search' to find skills, 'install' to download",
        },
        query: {
          type: "string",
          description:
            "Search query or install source. " +
            "Search syntax: keywords (space-separated), owner:xxx, repo:xxx. " +
            "Install syntax: owner/repo@skill or GitHub URL.",
        },
      },
      required: ["mode", "query"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const mode = String(params.mode ?? "search");
    const query = String(params.query ?? "").trim();

    if (!query) {
      return createToolResponse(false, "请提供搜索关键词或安装源");
    }

    if (mode === "search") {
      return await this.handleSearch(query, ctx);
    } else if (mode === "install") {
      return await this.handleInstall(query, ctx);
    } else {
      return createToolResponse(false, `未知模式: ${mode}，请使用 search 或 install`);
    }
  }

  // ─── 搜索模式 ───────────────────────────────────────────────────────────

  private async handleSearch(query: string, _ctx: ToolContext): Promise<ToolResponse> {
    try {
      // 解析搜索语法
      const parsed = this.parseSearchQuery(query);

      // 构建 npx skills find 命令的搜索词
      const searchTerms = [...parsed.keywords];
      if (parsed.owner) {
        // npx skills find 支持 owner 名作为关键词
        searchTerms.push(parsed.owner);
      }
      if (parsed.repo) {
        searchTerms.push(parsed.repo);
      }
      if (parsed.exact) {
        searchTerms.push(parsed.exact);
      }

      const searchTerm = searchTerms.join(" ");
      const cmd = `npx skills find "${searchTerm}" 2>&1`;

      console.log(`[find_skill] 执行搜索: ${cmd}`);
      // 异步执行，避免阻塞事件循环（execSync 会冻结 TUI 渲染/输入）
      let output: string;
      try {
        const { stdout } = await execAsyncP(cmd, { encoding: "utf-8", timeout: 30000 } as Record<string, unknown>);
        output = stdout;
      } catch (e) {
        output = (e as { stdout?: string; stderr?: string }).stdout ?? (e as { stderr?: string }).stderr ?? String(e);
      }

      // 解析结果
      let results = this.parseSearchOutput(output);

      // 如果指定了 owner，在前端进一步过滤
      if (parsed.owner) {
        results = results.filter(r =>
          r.owner.toLowerCase().includes(parsed.owner!.toLowerCase())
        );
      }

      // 如果指定了 repo，在前端进一步过滤
      if (parsed.repo) {
        results = results.filter(r =>
          r.repo.toLowerCase().includes(parsed.repo!.toLowerCase())
        );
      }

      if (results.length === 0) {
        return createToolResponse(false, `未找到匹配 "${query}" 的 skill`);
      }

      // 格式化输出
      const formatted = this.formatSearchResults(results, query);
      return createToolResponse(true, formatted, {
        payload: { query, count: results.length, results },
        displayEvents: [{ type: "terminal", stream: "info", text: `[skill 搜索] 找到 ${results.length} 个结果` }],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return createToolResponse(false, `搜索失败: ${msg}`);
    }
  }

  private parseSearchQuery(query: string): ParsedSearchQuery {
    const result: ParsedSearchQuery = { keywords: [] };

    // 拆分关键词
    const parts = query.split(/\s+/);

    for (const part of parts) {
      // owner:xxx 前缀
      if (part.startsWith("owner:")) {
        result.owner = part.slice(6);
        continue;
      }
      // repo:xxx 前缀
      if (part.startsWith("repo:")) {
        result.repo = part.slice(5);
        continue;
      }
      // "精确匹配" 引号
      if (part.startsWith('"') && part.endsWith('"')) {
        result.exact = part.slice(1, -1);
        continue;
      }
      // 普通关键词
      if (part.length > 0) {
        result.keywords.push(part);
      }
    }

    return result;
  }

  private parseSearchOutput(output: string): SkillSearchResult[] {
    const results: SkillSearchResult[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      // 匹配格式: larksuite/cli@lark-im 235.6K installs
      // ANSI 转义码格式: [38;5;145mowner/repo@skill[0m [36minstalls[0m
      // 简化匹配：去掉 ANSI 码后提取
      const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');

      // 匹配: owner/repo@skill 数字+K/M installs
      const match = cleanLine.match(/^([^\s/]+\/[^\s/@]+)@([^\s]+)\s+([\d.]+[KMB]?)\s*installs/);
      if (match) {
        const [, ownerRepo, skillName, installsStr] = match;

        // 提取 owner 和 repo
        const [owner, repo] = ownerRepo.split("/");

        // 解析安装量
        const installs = this.parseInstalls(installsStr);

        // 提取 URL
        const urlMatch = cleanLine.match(/(https:\/\/skills\.sh\/[^\s]+)/);
        const url = urlMatch ? urlMatch[1] : `https://skills.sh/${ownerRepo}/${skillName}`;

        results.push({
          id: `${ownerRepo}@${skillName}`,
          owner,
          repo,
          skill: skillName,
          name: skillName,
          installs,
          displayInstalls: installsStr,
          description: "",
          url,
        });
      }
    }

    // 按安装量排序
    results.sort((a, b) => b.installs - a.installs);

    return results;
  }

  private parseInstalls(str: string): number {
    const num = parseFloat(str);
    if (str.includes("K")) return num * 1000;
    if (str.includes("M")) return num * 1000000;
    if (str.includes("B")) return num * 1000000000;
    return num;
  }

  private formatSearchResults(results: SkillSearchResult[], query: string): string {
    const lines: string[] = [`搜索 "${query}" 找到 ${results.length} 个 skill（按安装量排序）：`, ""];

    for (let i = 0; i < Math.min(results.length, 20); i++) {
      const r = results[i];
      lines.push(`${i + 1}. **${r.id}**`);
      lines.push(`   安装量: ${r.displayInstalls}`);
      lines.push(`   链接: ${r.url}`);
      lines.push("");
    }

    if (results.length > 20) {
      lines.push(`... 还有 ${results.length - 20} 个结果`);
      lines.push("");
    }

    lines.push("安装方法: find_skill mode=install query=\"owner/repo@skill\"");
    lines.push("示例: find_skill mode=install query=\"larksuite/cli@lark-im\"");

    return lines.join("\n");
  }

  // ─── 安装模式 ───────────────────────────────────────────────────────────

  private async handleInstall(source: string, ctx: ToolContext): Promise<ToolResponse> {
    try {
      // 确定安装目录：agent 所属的 .maou/skills
      // 全局 agent: ~/.maou/skills
      // 项目 agent: project/.maou/skills
      const isGlobalAgent = ctx.projectRoot === ctx.sandboxRoot || ctx.agentName === "default";
      const maouDir = isGlobalAgent
        ? join(homedir(), ".maou")
        : join(ctx.projectRoot, ".maou");
      const skillsDir = join(maouDir, "skills");

      // 确保目录存在
      if (!existsSync(skillsDir)) {
        mkdirSync(skillsDir, { recursive: true });
      }

      // 解析安装源
      const parsed = this.parseInstallSource(source);

      if (!parsed) {
        return createToolResponse(false, `无法解析安装源: "${source}"\n格式应为: owner/repo@skill 或 GitHub URL`);
      }

      // 执行安装
      console.log(`[find_skill] 安装 ${parsed.skillId} 到 ${skillsDir}`);

      // 使用 npx skills add 命令
      // 注意：npx skills add 会安装到项目目录的 skills/，我们需要手动处理
      const skillDir = join(skillsDir, parsed.skill);

      // 检查是否已安装
      if (existsSync(join(skillDir, "SKILL.md"))) {
        return createToolResponse(true, `skill "${parsed.skill}" 已安装到 ${skillDir}`, {
          payload: { source, skillId: parsed.skillId, targetDir: skillDir, alreadyInstalled: true },
          displayEvents: [{ type: "terminal", stream: "info", text: `[skill 安装] ${parsed.skill} 已存在` }],
        });
      }

      // 下载 skill
      // 方法：npx skills add --copy -y (安装到临时目录然后移动)
      const tempDir = join(maouDir, "temp_skills");
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

      const addCmd = `cd "${tempDir}" && npx skills add ${parsed.ownerRepo}@${parsed.skill} --copy -y 2>&1`;
      console.log(`[find_skill] 执行: ${addCmd}`);

      // 异步执行，避免阻塞事件循环（execSync 会冻结 TUI 渲染/输入）
      let addOutput: string;
      try {
        const { stdout } = await execAsyncP(addCmd, { encoding: "utf-8", timeout: 60000, cwd: tempDir } as Record<string, unknown>);
        addOutput = stdout;
      } catch (e) {
        addOutput = (e as { stdout?: string; stderr?: string }).stdout ?? (e as { stderr?: string }).stderr ?? String(e);
      }

      // 检查临时目录中的 skill
      const tempSkillDir = join(tempDir, "skills", parsed.skill);
      if (existsSync(tempSkillDir)) {
        // 复制到目标目录
        mkdirSync(skillDir, { recursive: true });
        cpSync(tempSkillDir, skillDir, { recursive: true });

        // 清理临时目录
        // execSync(`rm -rf "${tempDir}/skills"`, { encoding: "utf-8" });

        return createToolResponse(true, this.formatInstallResult(parsed, skillDir, addOutput), {
          payload: { source, skillId: parsed.skillId, targetDir: skillDir },
          displayEvents: [{ type: "terminal", stream: "info", text: `[skill 安装成功] ${parsed.skill}` }],
        });
      } else {
        // npx skills add 可能安装到了其他位置，尝试查找
        const projectSkillsDir = join(process.cwd(), "skills", parsed.skill);
        if (existsSync(projectSkillsDir)) {
          mkdirSync(skillDir, { recursive: true });
          cpSync(projectSkillsDir, skillDir, { recursive: true });

          return createToolResponse(true, this.formatInstallResult(parsed, skillDir, addOutput), {
            payload: { source, skillId: parsed.skillId, targetDir: skillDir },
            displayEvents: [{ type: "terminal", stream: "info", text: `[skill 安装成功] ${parsed.skill}` }],
          });
        }

        return createToolResponse(false, `安装失败: 未找到 skill 文件\n${addOutput}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return createToolResponse(false, `安装失败: ${msg}`);
    }
  }

  private parseInstallSource(source: string): { ownerRepo: string; skill: string; skillId: string } | null {
    // 格式1: owner/repo@skill
    const match1 = source.match(/^([^/]+\/[^/@]+)@([^/@]+)$/);
    if (match1) {
      const [, ownerRepo, skill] = match1;
      return { ownerRepo, skill, skillId: `${ownerRepo}@${skill}` };
    }

    // 格式2: GitHub URL https://github.com/owner/repo
    const match2 = source.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)/);
    if (match2) {
      // 从 URL 无法确定具体 skill，返回整个仓库
      const ownerRepo = match2[1];
      return { ownerRepo, skill: "*", skillId: `${ownerRepo}@*` };
    }

    // 格式3: GitHub URL https://github.com/owner/repo/tree/main/skills/skill-name
    const match3 = source.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)(?:\/tree\/[^/]+\/skills\/([^/]+))?/);
    if (match3) {
      const [, ownerRepo, skill] = match3;
      return { ownerRepo, skill: skill || "*", skillId: `${ownerRepo}@${skill || "*"}` };
    }

    return null;
  }

  private formatInstallResult(parsed: { skillId: string; skill: string }, targetDir: string, output: string): string {
    const lines: string[] = [
      `✅ skill "${parsed.skill}" 安装成功`,
      "",
      `安装位置: ${targetDir}`,
      `来源: ${parsed.skillId}`,
      "",
      "使用方法:",
      `- 在对话中调用: use_skill name="${parsed.skill}"`,
      `- 或在 agent 配置中添加: skills: ["${parsed.skill}"]`,
      "",
    ];

    // 如果输出中有有用的信息，附加
    if (output && !output.includes("error")) {
      lines.push("安装日志:");
      lines.push(output.slice(0, 500));
    }

    return lines.join("\n");
  }
}