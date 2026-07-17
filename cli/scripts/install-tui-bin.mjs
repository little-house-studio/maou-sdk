/**
 * 把 release/debug 编译产物装到 ~/.maou/bin（跨平台）。
 * build:tui-ratatui 成功后自动调用。
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  constants as fsConstants,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const isWin = process.platform === "win32";
const name = isWin ? "maou-tui-ratatui.exe" : "maou-tui-ratatui";

const candidates = [
  join(cliRoot, "tui-ratatui", "target", "release", name),
  join(cliRoot, "tui-ratatui", "target", "release", "maou-tui-ratatui"),
  join(cliRoot, "tui-ratatui", "target", "debug", name),
  join(cliRoot, "tui-ratatui", "target", "debug", "maou-tui-ratatui"),
];

const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.error(
    "[install-tui-bin] 未找到编译产物。先: npm run build:tui-ratatui（或 cargo build --release）",
  );
  process.exit(1);
}

const destDir = join(homedir(), ".maou", "bin");
const dest = join(destDir, name);
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
if (!isWin) {
  try {
    chmodSync(
      dest,
      fsConstants.S_IRWXU |
        fsConstants.S_IRGRP |
        fsConstants.S_IXGRP |
        fsConstants.S_IROTH |
        fsConstants.S_IXOTH,
    );
  } catch {
    /* ignore */
  }
}
console.log(`[install-tui-bin] ${src} → ${dest}`);
