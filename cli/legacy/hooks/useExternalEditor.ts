/**
 * useExternalEditor —— Ctrl+G 外部编辑器回退
 *
 * 当 IME 不可用或用户需要编辑长文本时，按 Ctrl+G 打开 $EDITOR。
 * 1. 退出备用屏（\x1b[?1049l）
 * 2. 同步启动 $EDITOR 编辑临时文件
 * 3. 重新进入备用屏（\x1b[?1049h）
 * 4. 读取文件内容返回
 *
 * 与 Pi TUI 的 Ctrl+G 行为一致。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function openExternalEditor(initialText: string): string | null {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const tmpFile = join(tmpdir(), `maou-edit-${Date.now()}.md`);

  try {
    writeFileSync(tmpFile, initialText, "utf-8");
  } catch {
    return null;
  }

  // 退出备用屏，让编辑器接管终端
  process.stdout.write("\x1b[?1049l");

  try {
    spawnSync(editor, [tmpFile], {
      stdio: "inherit",
      env: process.env,
    });
  } catch {
    // 编辑器异常退出
  }

  // 重新进入备用屏
  process.stdout.write("\x1b[?1049h\x1b[H");

  try {
    const content = readFileSync(tmpFile, "utf-8");
    unlinkSync(tmpFile);
    // 去掉末尾换行（编辑器通常会加）
    return content.replace(/\n$/, "");
  } catch {
    return null;
  }
}
