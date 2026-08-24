/**
 * Windows Agent 命令包装。与 Rust `shell.rs` classify / windows_agent_invocation 对齐。
 * Unix 不走这里。
 */

import { existsSync } from "node:fs";

export type WindowsShellKind = "powershell" | "cmd" | "unix-like";

export function classifyWindowsShell(program: string): WindowsShellKind {
  const n = program.replace(/\\/g, "/").toLowerCase();
  const file = n.split("/").pop() ?? n;
  const stem = file.replace(/\.exe$/i, "");
  if (stem === "pwsh" || stem.includes("powershell")) return "powershell";
  if (stem === "cmd") return "cmd";
  if (
    stem === "bash" ||
    stem === "sh" ||
    stem === "zsh" ||
    stem === "fish" ||
    stem === "dash" ||
    stem.includes("git-bash")
  ) {
    return "unix-like";
  }
  return "cmd";
}

/** `MAOU_SHELL` → Windows PowerShell 5.1 → cmd（与人壳默认一致）。 */
export function resolveWindowsAgentShell(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MAOU_SHELL?.trim();
  if (override) return override;
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || "C:\\Windows";
  const ps = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  if (existsSync(ps)) return ps;
  return env.ComSpec || env.COMSPEC || `${root}\\System32\\cmd.exe`;
}

export function windowsAgentInvocation(
  command: string,
  program: string,
): { program: string; args: string[] } {
  switch (classifyWindowsShell(program)) {
    case "powershell":
      return { program, args: ["-NoProfile", "-NonInteractive", "-Command", command] };
    case "unix-like":
      return { program, args: ["-c", command] };
    default:
      return { program, args: ["/d", "/s", "/c", command] };
  }
}

const UNIX_PIPEFAIL_STEMS = new Set(["bash", "zsh", "sh"]);

function unixShellStem(program: string): string {
  const file = program.replace(/\\/g, "/").split("/").pop() ?? program;
  return file.toLowerCase();
}

/** bash / zsh / sh：管道退出码跟失败的那一段。 */
export function wrapUnixPipefail(command: string, shellProgram: string): string {
  if (!UNIX_PIPEFAIL_STEMS.has(unixShellStem(shellProgram))) return command;
  if (/(?:^|[;\n])\s*set\s+-o\s+pipefail\b/.test(command)) return command;
  return `set -o pipefail; ${command}`;
}

/** Agent 命令：Windows 走上面的解析；Unix 仍 `$SHELL -c`。 */
export function agentShellInvocation(command: string): { program: string; args: string[] } {
  if (process.platform === "win32") {
    return windowsAgentInvocation(command, resolveWindowsAgentShell());
  }
  const shell = process.env.SHELL?.trim() || "/bin/sh";
  return { program: shell, args: ["-c", wrapUnixPipefail(command, shell)] };
}
