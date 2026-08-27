/** Electron `process.platform` as painted on `<html data-app-chrome>`. */
export type AppChrome = "darwin" | "win32" | "linux";

export function resolveAppChrome(
  platform?: string,
  userAgent = "",
): AppChrome | "" {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }
  if (!/Electron/i.test(userAgent)) return "";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "darwin";
  if (/Windows NT/i.test(userAgent)) return "win32";
  if (/Linux/i.test(userAgent)) return "linux";
  return "";
}

export function paintDesktopChrome(
  root: { dataset: { appChrome?: string } } = document.documentElement,
  platform?: string,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): void {
  const chrome = resolveAppChrome(platform, userAgent);
  if (!chrome) return;
  root.dataset.appChrome = chrome;
}
