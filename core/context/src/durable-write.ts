/**
 * 耐久写：追加失败截回原长；整文件替换走 tmp + fsync + rename + 目录 fsync。
 */

import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { crc32 as zlibCrc32 } from "node:zlib";

export function crc32of(data: string | Buffer): number {
  return zlibCrc32(typeof data === "string" ? Buffer.from(data, "utf-8") : data);
}

let injectAppendFailure = false;

/** 单测：下一次 durableAppend 在 write 之后抛错，验证截回原长。 */
export function injectDurableAppendFailure(): void {
  injectAppendFailure = true;
}

function syncDir(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* Windows / 某些 FS 不能 fsync 目录 */
  }
}

/** 追加并 fsync；写或 sync 失败则截回追加前长度。 */
export function durableAppend(filePath: string, data: string | Buffer): { before: number; after: number } {
  mkdirSync(dirname(filePath), { recursive: true });
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  const fd = openSync(filePath, "a");
  const before = fstatSync(fd).size;
  try {
    writeSync(fd, buf);
    if (injectAppendFailure) {
      injectAppendFailure = false;
      throw new Error("injected durable append fail");
    }
    fsyncSync(fd);
    return { before, after: before + buf.length };
  } catch (err) {
    try {
      ftruncateSync(fd, before);
      fsyncSync(fd);
    } catch {
      /* 回滚失败留给下次读侧跳过半行 */
    }
    throw err;
  } finally {
    closeSync(fd);
  }
}

/** tmp + fsync + rename + 目录 fsync。 */
export function durableAtomicWrite(filePath: string, data: string | Buffer): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  const fd = openSync(tmp, "wx");
  try {
    writeSync(fd, buf);
    fsyncSync(fd);
  } catch (err) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
  closeSync(fd);
  renameSync(tmp, filePath);
  syncDir(dir);
}

export function durableAtomicWriteJson(filePath: string, data: unknown): void {
  durableAtomicWrite(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function fileSizeOrZero(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  const fd = openSync(filePath, "r");
  try {
    return fstatSync(fd).size;
  } finally {
    closeSync(fd);
  }
}
