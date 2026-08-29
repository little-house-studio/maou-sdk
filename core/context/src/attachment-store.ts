/**
 * 用户主目录附件库：内容寻址，超限整批拒收。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveUserAttachmentsDir, type MessageImage } from "@little-house-studio/types";

export const MAX_ATTACH_COUNT = 4;
export const MAX_ATTACH_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACH_EDGE = 8192;
export const MAX_ATTACH_PIXELS = 24_000_000;
export const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

export class AttachmentRejectError extends Error {
  readonly code = "attachment_rejected";
  constructor(message: string) {
    super(message);
    this.name = "AttachmentRejectError";
  }
}

export type AttachmentMeta = {
  hash: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  name?: string;
};

function attachmentsRoot(override?: string): string {
  const dir = override ?? resolveUserAttachmentsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeMime(mime: string): string {
  const m = mime.trim().toLowerCase();
  return m === "image/jpg" ? "image/jpeg" : m;
}

export function decodeImageBytes(data: string): Buffer {
  const trimmed = data.trim();
  const comma = trimmed.indexOf(",");
  const b64 =
    trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed.replace(/\s+/g, "");
  return Buffer.from(b64, "base64");
}

export function readImageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X" && buf.length >= 30) {
      return {
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
      };
    }
    if (kind === "VP8 " && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L" && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1]!;
      const size = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && i + 8 < buf.length) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + size;
    }
  }
  return null;
}

function validateOne(raw: {
  mimeType?: unknown;
  data?: unknown;
  hash?: unknown;
  name?: unknown;
}): { mime: string; bytes: Buffer; name?: string } {
  const mime = normalizeMime(String(raw.mimeType ?? ""));
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    throw new AttachmentRejectError("只收 png / jpeg / gif / webp。整批未入库。");
  }
  if (typeof raw.data !== "string" || !raw.data.trim()) {
    throw new AttachmentRejectError("图没有数据。整批未入库。");
  }
  const bytes = decodeImageBytes(raw.data);
  if (bytes.length === 0) throw new AttachmentRejectError("图是空的。整批未入库。");
  if (bytes.length > MAX_ATTACH_BYTES) {
    throw new AttachmentRejectError(`单张超过 ${MAX_ATTACH_BYTES / (1024 * 1024)}MB。整批未入库。`);
  }
  const size = readImageSize(bytes);
  if (!size || size.width < 1 || size.height < 1) {
    throw new AttachmentRejectError("读不出宽高。整批未入库。");
  }
  if (size.width > MAX_ATTACH_EDGE || size.height > MAX_ATTACH_EDGE) {
    throw new AttachmentRejectError(`边长超过 ${MAX_ATTACH_EDGE}px。整批未入库。`);
  }
  if (size.width * size.height > MAX_ATTACH_PIXELS) {
    throw new AttachmentRejectError("像素太多。整批未入库。");
  }
  return {
    mime,
    bytes,
    ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name.trim() } : {}),
  };
}

export function ingestImageBatch(
  raw: unknown,
  opts?: { root?: string },
): MessageImage[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new AttachmentRejectError("附图必须是一组图。整批未入库。");
  if (raw.length === 0) return [];
  if (raw.length > MAX_ATTACH_COUNT) {
    throw new AttachmentRejectError(`一次最多 ${MAX_ATTACH_COUNT} 张。整批未入库。`);
  }
  const checked = raw.map((item) => {
    if (!item || typeof item !== "object") {
      throw new AttachmentRejectError("有一张不是图。整批未入库。");
    }
    const rec = item as { mimeType?: unknown; data?: unknown; hash?: unknown; name?: unknown };
    if (typeof rec.hash === "string" && rec.hash && !rec.data) {
      const stored = readAttachment(rec.hash, opts);
      if (!stored) throw new AttachmentRejectError("库里找不到这张图。整批未入库。");
      return stored;
    }
    const one = validateOne(rec);
    const size = readImageSize(one.bytes)!;
    const hash = createHash("sha256").update(one.bytes).digest("hex");
    const root = attachmentsRoot(opts?.root);
    const binPath = join(root, hash);
    const metaPath = join(root, `${hash}.json`);
    if (!existsSync(binPath)) writeFileSync(binPath, one.bytes);
    const meta: AttachmentMeta = {
      hash,
      mime: one.mime,
      bytes: one.bytes.length,
      width: size.width,
      height: size.height,
      ...(one.name ? { name: one.name } : {}),
    };
    if (!existsSync(metaPath)) writeFileSync(metaPath, `${JSON.stringify(meta)}\n`);
    writeThumbIfNeeded(root, hash, one.bytes);
    return {
      mimeType: one.mime,
      hash,
      ...(one.name ? { name: one.name } : {}),
      bytes: one.bytes.length,
      width: size.width,
      height: size.height,
    } satisfies MessageImage;
  });
  return checked;
}

export function readAttachment(
  hash: string,
  opts?: { root?: string },
): MessageImage | null {
  const root = attachmentsRoot(opts?.root);
  const binPath = join(root, hash);
  const metaPath = join(root, `${hash}.json`);
  if (!existsSync(binPath)) return null;
  const bytes = readFileSync(binPath);
  const expect = createHash("sha256").update(bytes).digest("hex");
  if (expect !== hash) return null;
  let meta: Partial<AttachmentMeta> = {};
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf-8")) as AttachmentMeta;
    } catch {
      meta = {};
    }
  }
  return {
    mimeType: meta.mime || "image/png",
    data: bytes.toString("base64"),
    hash,
    ...(meta.name ? { name: meta.name } : {}),
    bytes: bytes.length,
    width: meta.width,
    height: meta.height,
  };
}

export function hydrateMessageImages(
  images: MessageImage[] | undefined,
  opts?: { root?: string },
): MessageImage[] {
  if (!images?.length) return [];
  return images.map((img) => {
    if (img.data && img.hash) {
      const bytes = decodeImageBytes(img.data);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== img.hash) throw new AttachmentRejectError("图和哈希对不上。");
      return img;
    }
    if (img.hash && !img.data) {
      const stored = readAttachment(img.hash, opts);
      if (!stored) throw new AttachmentRejectError("库里找不到这张图。");
      return stored;
    }
    return img;
  });
}

/** 已经很小就另存一份 thumb；缩不了也不影响原图。 */
export function writeThumbIfNeeded(root: string, hash: string, bytes: Buffer): void {
  const thumb = join(root, `${hash}.thumb`);
  if (existsSync(thumb)) return;
  if (bytes.length <= 200 * 1024) {
    try {
      writeFileSync(thumb, bytes);
    } catch {
      /* 缩略图失败不影响原图 */
    }
  }
}
