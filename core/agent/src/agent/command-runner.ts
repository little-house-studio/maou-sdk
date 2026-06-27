/**
 * Agent 自定义指令执行 —— eve 的 command/ 目录。
 * 文件名 = 指令名。用户发 /<name> 时执行 agents/<agent>/command/<name>.{sh,mjs,ts,md}。
 * .md 直接返回内容（固定回复）；脚本执行后返回 stdout/stderr。无此命令返回 null（交回普通流程）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TIMEOUT_MS = 30_000;

/** 执行 agent 的自定义指令。返回输出文本，或 null（无此命令）。 */
export async function runAgentCommand(
  agentDir: string,
  name: string,
  argline: string,
  cwd: string,
): Promise<string | null> {
  const cmdDir = join(agentDir, "command");
  const candidates: Array<[string, "md" | "sh" | "node" | "tsx"]> = [
    [`${name}.md`, "md"],
    [`${name}.sh`, "sh"],
    [`${name}.mjs`, "node"],
    [`${name}.js`, "node"],
    [`${name}.ts`, "tsx"],
  ];
  for (const [file, kind] of candidates) {
    const p = join(cmdDir, file);
    if (!existsSync(p)) continue;
    if (kind === "md") {
      try { return readFileSync(p, "utf-8"); } catch { return `(无法读取指令 ${name})`; }
    }
    const { execFile } = await import("node:child_process");
    const cmd = kind === "sh" ? "sh" : kind === "tsx" ? "npx" : "node";
    const args = kind === "tsx" ? ["tsx", p, argline] : [p, argline];
    return await new Promise<string>((resolve) => {
      const child = execFile(cmd, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
          resolve(out || (err ? `指令 /${name} 执行失败: ${err}` : `指令 /${name} 已执行（无输出）`));
        });
      child.on("error", () => resolve(`无法执行指令 /${name}`));
    });
  }
  return null;
}
