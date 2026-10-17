/**
 * 工具层视觉能力：读图 / 截图不得在模型不吃图时静默塞像素。
 */

import type { ToolContext } from "./base.js";

export const VISION_UNAVAILABLE_HINT =
  "当前模型不支持视觉，未注入图片像素。请改用文字检查（read_file / console / state），或换支持图片的模型。";

export function ctxSupportsVision(ctx: ToolContext | undefined): boolean {
  return ctx?.supportsVision !== false;
}

export function visionUnavailableMessage(detail: string): string {
  const head = detail.trim();
  return head ? `${head}\n${VISION_UNAVAILABLE_HINT}` : VISION_UNAVAILABLE_HINT;
}
