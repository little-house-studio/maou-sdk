/**
 * rustc 版本探测 —— 本机编 TUI / terminal-engine 需要 ≥ 1.88。
 * 更旧的 cargo（例如 1.85）会编失败，应直接走预编译。
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const MIN_RUSTC = { major: 1, minor: 88, patch: 0 };
export const MIN_RUSTC_LABEL = "1.88";

/** @typedef {{ major: number, minor: number, patch: number }} Semver */

/**
 * @param {string} text `rustc --version` 输出
 * @returns {Semver | null}
 */
export function parseRustcVersion(text) {
  const m = String(text ?? "").match(/rustc\s+(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * @param {Semver} a
 * @param {Semver} b
 */
export function semverGte(a, b) {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

/** @param {string} text */
export function rustcMeetsMin(text) {
  const v = parseRustcVersion(text);
  return Boolean(v && semverGte(v, MIN_RUSTC));
}

function rustcCandidates() {
  const exe = platform() === "win32" ? "rustc.exe" : "rustc";
  return [exe, join(homedir(), ".cargo", "bin", exe)];
}

/**
 * @returns {{ ok: boolean, version: string | null, raw: string }}
 */
export function probeRustc() {
  for (const cmd of rustcCandidates()) {
    if (cmd.includes("/") || cmd.includes("\\")) {
      if (!existsSync(cmd)) continue;
    }
    const r = spawnSync(cmd, ["--version"], {
      encoding: "utf-8",
      windowsHide: true,
    });
    if (r.status !== 0) continue;
    const raw = `${r.stdout ?? ""} ${r.stderr ?? ""}`.trim();
    const v = parseRustcVersion(raw);
    if (!v) continue;
    return {
      ok: semverGte(v, MIN_RUSTC),
      version: `${v.major}.${v.minor}.${v.patch}`,
      raw,
    };
  }
  return { ok: false, version: null, raw: "" };
}
