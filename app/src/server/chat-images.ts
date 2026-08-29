/**
 * POST /api/chat 附图：整批验收后入内容寻址库。超限抛错，不静默截断。
 */
import type { MessageImage } from "@little-house-studio/types";
import {
  AttachmentRejectError,
  ingestImageBatch,
  MAX_ATTACH_COUNT,
} from "@little-house-studio/context";

export const MAX_CHAT_IMAGES = MAX_ATTACH_COUNT;
export { AttachmentRejectError };

export function sanitizeChatImages(raw: unknown): MessageImage[] {
  return ingestImageBatch(raw);
}
