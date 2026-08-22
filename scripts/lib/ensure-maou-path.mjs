/**
 * 把 ~/.maou/bin 写进常见 shell rc / 用户 PATH，并尽量链到已在 PATH 上的目录。
 * 当前进程也会 prepend，方便同一次 setup:dev 里后续步骤找到 maou。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  copyFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const IS_WIN = platform() === "win32";

function fileHas(file, needle) {
  try {
    return readFileSync(file, "utf-8").includes(needle);
  } catch {
    return false;
  }
}

function appendLine(file, line, comment) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file) && fileHas(file, line)) return "exists";
    const prev = existsSync(file) ? readFileSync(file, "utf-8") : "";
    const pad = prev && !prev.endsWith("\n") ? "\n" : "";
    writeFileSync(file, `${prev}${pad}\n${comment}\n${line}\n`, "utf-8");
    return "added";
  } catch {
    return "fail";
  }
}

function installLink(src, destDir, destName) {
  if (!destDir) return false;
  try {
    mkdirSync(destDir, { recursive: true });
  } catch {
    return false;
  }
  const dest = join(destDir, destName);
  try {
    symlinkSync(src, dest);
    return true;
  } catch {
    try {
      copyFileSync(src, dest);
      return true;
    } catch {
      return false;
    }
  }
}

function prependPath(dir) {
  const sep = IS_WIN ? ";" : ":";
  const cur = process.env.PATH ?? "";
  if (`${sep}${cur}${sep}`.includes(`${sep}${dir}${sep}`)) return;
  process.env.PATH = `${dir}${sep}${cur}`;
}

/**
 * @param {string} binDir  ~/.maou/bin
 * @param {{ log?: (m: string) => void }} [opts]
 * @returns {{ wroteRc: string[], linked: string[] }}
 */
export function ensureMaouBinOnPath(binDir, opts = {}) {
  const log = opts.log ?? (() => {});
  if (process.env.MAOU_NO_PATH === "1") {
    log("  MAOU_NO_PATH=1，不改 shell / 用户 PATH");
    return { wroteRc: [], linked: [] };
  }

  prependPath(binDir);
  const wroteRc = [];
  const linked = [];
  const home = homedir();
  const launcherName = IS_WIN ? "maou.cmd" : "maou";
  const launcher = join(binDir, launcherName);

  if (IS_WIN) {
    const userPath = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$d=${JSON.stringify(binDir)}; $p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $p){$p=''}; if($p -notlike ('*'+$d+'*')){ [Environment]::SetEnvironmentVariable('Path', $d+';'+$p, 'User'); 'added' } else { 'exists' }`,
      ],
      { encoding: "utf-8", windowsHide: true },
    );
    if ((userPath.stdout ?? "").trim() === "added") {
      wroteRc.push("User PATH");
      log(`  已写入用户 PATH → ${binDir}`);
    }
    return { wroteRc, linked };
  }

  const line = `export PATH="${binDir}:$PATH"`;
  const comment = "# maou（setup:dev / 安装器写入，使 maou 不用手动 export）";
  const shell = process.env.SHELL ?? "";
  const rcs = [];
  if (shell.includes("zsh") || existsSync(join(home, ".zshrc")) || existsSync(join(home, ".zprofile"))) {
    rcs.push(join(home, ".zprofile"), join(home, ".zshrc"));
  }
  if (shell.includes("bash") || existsSync(join(home, ".bashrc")) || existsSync(join(home, ".bash_profile"))) {
    rcs.push(join(home, ".bash_profile"), join(home, ".bashrc"));
  }
  rcs.push(join(home, ".profile"));
  for (const rc of [...new Set(rcs)]) {
    const result = appendLine(rc, line, comment);
    if (result === "added") {
      wroteRc.push(rc);
      log(`  已写入 PATH → ${rc}`);
    }
  }

  const fishDir = join(home, ".config", "fish");
  if (existsSync(fishDir)) {
    const fishRc = join(fishDir, "config.fish");
    const fishLine = `set -gx PATH ${binDir} $HOME/.local/bin $PATH`;
    if (appendLine(fishRc, fishLine, "# maou") === "added") {
      wroteRc.push(fishRc);
      log(`  已写入 PATH → ${fishRc}`);
    }
  }

  if (existsSync(launcher)) {
    const candidates = [join(home, ".local", "bin")];
    const brew = spawnSync("brew", ["--prefix"], { encoding: "utf-8" });
    if (brew.status === 0 && brew.stdout?.trim()) {
      candidates.unshift(join(brew.stdout.trim(), "bin"));
    }
    for (const d of candidates) {
      if (installLink(launcher, d, "maou")) {
        linked.push(d);
        prependPath(d);
        log(`  已链接 ${join(d, "maou")} → ${launcher}`);
        break;
      }
    }
  }

  return { wroteRc, linked };
}
