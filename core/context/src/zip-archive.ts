/**
 * 最小 ZIP（store + deflate）。host 流式写出，不把整包留在内存。
 */

import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Buffer };

function dosDate(d = new Date()): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

export function zipBuffers(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf-8");
    const raw = entry.data;
    const compressed = deflateRawSync(raw);
    const use = compressed.length < raw.length ? compressed : raw;
    const method = compressed.length < raw.length ? 8 : 0;
    const checksum = crc32(raw);
    const local = Buffer.concat([
      Buffer.from("PK\u0003\u0004", "binary"),
      u16(20),
      u16(0),
      u16(method),
      u16(time),
      u16(date),
      u32(checksum),
      u32(use.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      use,
    ]);
    locals.push(local);
    const central = Buffer.concat([
      Buffer.from("PK\u0001\u0002", "binary"),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(time),
      u16(date),
      u32(checksum),
      u32(use.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centrals.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from("PK\u0005\u0006", "binary"),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, central, eocd]);
}
