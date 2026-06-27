/**
 * 原子写文件 —— 先写临时文件再 rename，避免写入中途崩溃留下半截文件。
 *
 * rename 在同一文件系统内是原子操作。如果 writeFileSync(tmp) 或 renameSync 失败，
 * 清理临时文件后把错误抛给调用方——不回退到非原子 writeFileSync。
 *
 * 致命#2 修复：原版本在 catch 中执行 writeFileSync(absPath) 非原子写，
 * 这会让「原子写」承诺失效：rename 失败时调用方拿不到错误，
 * 反而误以为写入成功——但下次读取到的可能是半截旧文件 / 旧版本 / 跨设备的脏数据。
 * 失败必须显式抛出，让上层 ToolResponse 返回 ok:false，让 LLM / 用户感知到失败。
 */

import { writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, basename, join } from "node:path";

/**
 * 原子写：tmp → rename。失败时清理 tmp 并抛出，不回退非原子写。
 * 调用方必须 try/catch 并把错误纳入 ToolResponse.ok=false。
 */
export function atomicWrite(absPath: string, content: string): void {
  const tmp = join(dirname(absPath), `.${basename(absPath)}.tmp-${process.pid}-${counter()}`);
  let renameOk = false;
  try {
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, absPath);
    renameOk = true;
  } finally {
    // 成功时 tmp 已被 rename 走，不存在；失败时 tmp 残留需清理
    if (!renameOk) {
      try { unlinkSync(tmp); } catch { /* tmp 可能已被 rename 或不存在 */ }
    }
  }
}

let _c = 0;
function counter(): number {
  _c = (_c + 1) % 1_000_000;
  return _c;
}
