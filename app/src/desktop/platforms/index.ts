import { darwin } from "./darwin.js";
import { linux } from "./linux.js";
import { win32 } from "./win32.js";
import type { AppPlatform, AppPlatformId } from "./types.js";

export type { AppPlatform, AppPlatformId } from "./types.js";
export { darwin } from "./darwin.js";
export { win32 } from "./win32.js";
export { linux } from "./linux.js";

export function appPlatform(
  id: NodeJS.Platform | AppPlatformId = process.platform,
): AppPlatform {
  if (id === "darwin") return darwin;
  if (id === "win32") return win32;
  return linux;
}
