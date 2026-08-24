import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { arch, platform, release } from "node:os";

export interface EnvProbe {
  os: string;
  arch: string;
  node: string;
  npm: string | null;
  git: string | null;
  python: string | null;
  pip: string | null;
  docker: string | null;
  destWritable: boolean | null;
}

function tryVersion(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = String(out).trim().split(/\r?\n/)[0] ?? "";
    return line || null;
  } catch {
    return null;
  }
}

export function probeEnvironment(dest?: string): EnvProbe {
  let destWritable: boolean | null = null;
  if (dest) {
    try {
      accessSync(dest, constants.W_OK);
      destWritable = true;
    } catch {
      destWritable = false;
    }
  }

  return {
    os: `${platform()} ${release()}`,
    arch: arch(),
    node: process.version,
    npm: tryVersion("npm", ["-v"]),
    git: tryVersion("git", ["--version"]),
    python: tryVersion("python3", ["--version"]) ?? tryVersion("python", ["--version"]),
    pip: tryVersion("pip3", ["--version"]) ?? tryVersion("pip", ["--version"]),
    docker: tryVersion("docker", ["--version"]),
    destWritable,
  };
}

export function formatEnvProbe(probe: EnvProbe, dest?: string): string {
  const lines = [
    `系统: ${probe.os} (${probe.arch})`,
    `Node: ${probe.node}`,
    `npm: ${probe.npm ?? "未找到"}`,
    `git: ${probe.git ?? "未找到"}`,
    `Python: ${probe.python ?? "未找到"}`,
    `pip: ${probe.pip ?? "未找到"}`,
    `Docker: ${probe.docker ?? "未找到"}`,
  ];
  if (dest) {
    lines.push(`目标目录: ${dest}`);
    if (probe.destWritable === false) lines.push("目标目录: 当前不可写");
  }
  return lines.join("\n");
}
