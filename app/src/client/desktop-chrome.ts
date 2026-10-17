/** 桌面壳平台（与 Node `process.platform` 同值），画在 `<html data-app-chrome>` 上。 */
export type AppChrome = "darwin" | "win32" | "linux";

export function resolveAppChrome(platform?: string): AppChrome | "" {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }
  return "";
}

export function paintDesktopChrome(
  root: { dataset: { appChrome?: string } } = document.documentElement,
  platform?: string,
): void {
  const chrome = resolveAppChrome(platform);
  if (!chrome) return;
  root.dataset.appChrome = chrome;
}

/** macOS 叠加标题栏：红绿灯压在顶栏上，顶栏要让位并充当拖拽条。 */
export function isDarwinChrome(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.appChrome === "darwin"
  );
}
