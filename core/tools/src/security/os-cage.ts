/**
 * OS 笼子：只包终端派生命令。装不上就拒绝，不退回裸执行。
 *
 * macOS：sandbox-exec；Linux：bwrap；Windows：本阶段不可用。
 */

import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

export type CageIsolation = "readonly" | "workspace" | "open";
export type CageBackend = "sandbox-exec" | "bwrap" | "none";

export type CageWrapOk = {
  ok: true;
  command: string;
  backend: CageBackend;
  isolation: CageIsolation;
};

export type CageWrapFail = {
  ok: false;
  code: "cage_unavailable";
  message: string;
};

export type CageWrapResult = CageWrapOk | CageWrapFail;

export type CageOverride = "auto" | "passthrough" | "unavailable";

let override: CageOverride = "auto";
let injectedBackend: CageBackend | null = null;

export function setCageOverride(next: CageOverride): void {
  override = next;
}

export function setCageBackendForTest(backend: CageBackend | null): void {
  injectedBackend = backend;
}

export function resetCageForTest(): void {
  override = "auto";
  injectedBackend = null;
}

const ISOLATION_RANK: Record<CageIsolation, number> = {
  readonly: 0,
  workspace: 1,
  open: 2,
};

export function isWiderIsolation(to: CageIsolation, from: CageIsolation): boolean {
  return ISOLATION_RANK[to] > ISOLATION_RANK[from];
}

export function isolationFromSandboxMode(sandboxMode: string | undefined): CageIsolation {
  const raw = String(sandboxMode ?? "").trim().toLowerCase();
  if (raw === "yolo" || raw === "open") return "open";
  if (raw === "readonly" || raw === "strict" || raw === "sandbox" || raw === "isolated") {
    return raw === "readonly" ? "readonly" : "workspace";
  }
  return "workspace";
}

function findBin(name: string): string | null {
  const extras =
    process.platform === "darwin"
      ? ["/usr/bin", "/usr/local/bin"]
      : ["/usr/bin", "/usr/local/bin", "/bin"];
  const dirs = [...extras, ...(process.env.PATH ?? "").split(delimiter)];
  for (const dir of dirs) {
    if (!dir) continue;
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export function detectCageBackend(): CageBackend | null {
  if (injectedBackend) return injectedBackend === "none" ? null : injectedBackend;
  if (process.platform === "win32") return null;
  if (process.platform === "darwin") {
    return findBin("sandbox-exec") ? "sandbox-exec" : null;
  }
  if (process.platform === "linux") {
    return findBin("bwrap") ? "bwrap" : null;
  }
  return null;
}

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sbplSubpath(abs: string): string {
  return abs.replace(/\\/g, "/").replace(/"/g, '\\"');
}

function sandboxProfile(isolation: CageIsolation, workspace: string): string {
  const ws = sbplSubpath(resolve(workspace));
  const tmpAllow = [
    '(subpath "/tmp")',
    '(subpath "/private/tmp")',
    '(subpath "/var/folders")',
    '(subpath "/private/var/folders")',
    '(subpath "/dev")',
  ].join(" ");
  if (isolation === "open") {
    return "(version 1) (allow default)";
  }
  if (isolation === "readonly") {
    return `(version 1) (allow default) (deny file-write*) (allow file-write* ${tmpAllow})`;
  }
  return `(version 1) (allow default) (deny file-write*) (allow file-write* (subpath "${ws}") ${tmpAllow})`;
}

function wrapSandboxExec(
  bin: string,
  command: string,
  isolation: CageIsolation,
  workspace: string,
): string {
  const profile = sandboxProfile(isolation, workspace);
  return `${shQuote(bin)} -p ${shQuote(profile)} /bin/sh -c ${shQuote(command)}`;
}

function wrapBwrap(
  bin: string,
  command: string,
  isolation: CageIsolation,
  workspace: string,
): string {
  const ws = resolve(workspace);
  if (isolation === "open") {
    return `${shQuote(bin)} --bind / / --dev /dev --proc /proc --die-with-parent --chdir ${shQuote(ws)} -- /bin/sh -c ${shQuote(command)}`;
  }
  const writeBind =
    isolation === "workspace" ? `--bind ${shQuote(ws)} ${shQuote(ws)}` : "";
  return [
    shQuote(bin),
    "--ro-bind / /",
    "--dev /dev",
    "--proc /proc",
    "--tmpfs /tmp",
    writeBind,
    "--die-with-parent",
    `--chdir ${shQuote(ws)}`,
    "-- /bin/sh -c",
    shQuote(command),
  ]
    .filter(Boolean)
    .join(" ");
}

export function wrapCommandInCage(
  command: string,
  opts: { isolation: CageIsolation; workspace: string },
): CageWrapResult {
  const isolation = opts.isolation;
  if (override === "passthrough") {
    return { ok: true, command, backend: "none", isolation };
  }
  if (override === "unavailable") {
    return {
      ok: false,
      code: "cage_unavailable",
      message: "OS cage unavailable (test override)",
    };
  }
  const backend = detectCageBackend();
  if (!backend) {
    return {
      ok: false,
      code: "cage_unavailable",
      message: `OS cage unavailable on ${process.platform}; command was not executed`,
    };
  }
  const bin =
    backend === "sandbox-exec" ? findBin("sandbox-exec") ?? "sandbox-exec" : findBin("bwrap") ?? "bwrap";
  const wrapped =
    backend === "sandbox-exec"
      ? wrapSandboxExec(bin, command, isolation, opts.workspace)
      : wrapBwrap(bin, command, isolation, opts.workspace);
  return { ok: true, command: wrapped, backend, isolation };
}
