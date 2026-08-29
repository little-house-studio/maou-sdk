/** Composer 附图：剪贴板 / 文件 → base64。谁写：输入条；谁读：streamChat。 */

export type ComposerImage = {
  mimeType: string;
  data: string;
  name?: string;
};

export const MAX_COMPOSER_IMAGES = 4;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function normalizeMime(mime: string): string {
  const m = mime.trim().toLowerCase();
  if (m === "image/jpg") return "image/jpeg";
  return m;
}

export function parseDataUrl(
  dataUrl: string,
  name?: string,
): ComposerImage | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!m) return null;
  const mime = normalizeMime(m[1]!);
  if (!mime.startsWith("image/")) return null;
  const data = m[2]!.replace(/\s+/g, "");
  if (!data) return null;
  return { mimeType: mime, data, ...(name ? { name } : {}) };
}

export class ComposerImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposerImageError";
  }
}

export async function fileToComposerImage(file: File): Promise<ComposerImage> {
  const mime = normalizeMime(file.type || "image/png");
  if (!mime.startsWith("image/")) {
    throw new ComposerImageError("只收图片。整批未入库。");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ComposerImageError(`单张超过 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB。整批未入库。`);
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { mimeType: mime, data: btoa(bin), name: file.name };
}

export async function filesToComposerImages(
  files: ArrayLike<File>,
  already = 0,
): Promise<ComposerImage[]> {
  if (already + files.length > MAX_COMPOSER_IMAGES) {
    throw new ComposerImageError(`一次最多 ${MAX_COMPOSER_IMAGES} 张。整批未入库。`);
  }
  const out: ComposerImage[] = [];
  for (let i = 0; i < files.length; i++) {
    out.push(await fileToComposerImage(files[i]!));
  }
  return out;
}

export async function clipboardToComposerImages(
  dt: DataTransfer | null,
  already = 0,
): Promise<ComposerImage[]> {
  if (!dt) return [];
  const files = [...dt.files].filter((f) => f.type.startsWith("image/"));
  if (files.length) return filesToComposerImages(files, already);
  const fromItems: File[] = [];
  for (const it of [...dt.items]) {
    if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
    const f = it.getAsFile();
    if (f) fromItems.push(f);
  }
  return filesToComposerImages(fromItems, already);
}

export function mergeComposerImages(
  current: readonly ComposerImage[],
  extra: readonly ComposerImage[],
): ComposerImage[] {
  if (current.length + extra.length > MAX_COMPOSER_IMAGES) {
    throw new ComposerImageError(`一次最多 ${MAX_COMPOSER_IMAGES} 张。整批未入库。`);
  }
  return [...current, ...extra];
}

export function imageDataUrl(img: ComposerImage): string {
  return `data:${img.mimeType};base64,${img.data}`;
}
