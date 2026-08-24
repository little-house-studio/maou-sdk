/**
 * 用系统默认浏览器打开 URL（可选，失败则静默）。
 */

import { spawn } from "node:child_process";

export function openInBrowser(url: string): void {
  try {
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // 打开失败不影响登录，调用方仍会打印 URL
  }
}

export function maybeOpen(url: string | undefined, enabled?: boolean): void {
  if (enabled && url) openInBrowser(url);
}
