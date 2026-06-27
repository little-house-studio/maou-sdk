/**
 * 原子写文件 —— 先写临时文件再 rename，避免写入中途崩溃留下半截文件。
 * rename 在同一文件系统内是原子操作；跨设备失败时回退普通写。
 */

import { writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, basename, join } from "node:path";

/** 原子写：tmp → rename。失败回退普通写，保证不因原子化反而写不进去。 */
export function atomicWrite(absPath: string, content: string): void {
  const tmp = join(dirname(absPath), `.${basename(absPath)}.tmp-${process.pid}-${counter()}`);
  try {
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, absPath);
  } catch {
    // 跨设备/权限等导致 rename 失败 —— 清理临时文件并回退普通写
    try { unlinkSync(tmp); } catch { /* ignore */ }
    writeFileSync(absPath, content, "utf-8");
  }
}

let _c = 0;
function counter(): number {
  _c = (_c + 1) % 1_000_000;
  return _c;
}
