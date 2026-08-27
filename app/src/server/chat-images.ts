/**
 * POST /api/chat 附图：校验 mime / 体积，剥 data URL 前缀。
 */
import type { MessageImage } from "@little-house-studio/types";

export const MAX_CHAT_IMAGES = 4;
/** 约 8MB 原图的 base64 上限 */
export const MAX_IMAGE_B64_CHARS = Math.ceil((8 * 1024 * 1024 * 4) / 3);

export function sanitizeChatImages(raw: unknown): MessageImage[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { mimeType?: unknown; data?: unknown };
    const mime = String(rec.mimeType ?? "")
      .trim()
      .toLowerCase();
    let data = String(rec.data ?? "").trim();
    if (!mime.startsWith("image/") || !data) continue;
    const comma = data.indexOf(",");
    if (data.startsWith("data:") && comma >= 0) data = data.slice(comma + 1);
    data = data.replace(/\s+/g, "");
    if (!data || data.length > MAX_IMAGE_B64_CHARS) continue;
    out.push({ mimeType: mime, data });
    if (out.length >= MAX_CHAT_IMAGES) break;
  }
  return out;
}
