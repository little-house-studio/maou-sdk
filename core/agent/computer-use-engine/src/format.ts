import type {
  Availability,
  ComputerPermissions,
  DesktopApp,
  DesktopWindow,
  Snapshot,
  UiElement,
} from "./types.js";

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function lineElement(el: UiElement): string {
  const name = el.title || el.description || el.value || "";
  const label = name ? ` "${clip(name, 48)}"` : "";
  const box = el.frame
    ? ` (${Math.round(el.frame.x)},${Math.round(el.frame.y)} ${Math.round(el.frame.w)}x${Math.round(el.frame.h)})`
    : "";
  const acts = el.actions?.length ? ` actions=${el.actions.join(",")}` : "";
  const off = el.enabled === false ? " disabled" : "";
  return `[${el.ref}] ${el.role}${label}${box}${acts}${off}`;
}

export function formatSnapshot(s: Snapshot): string {
  const head = `[snapshot ${s.snapshotId} route=${s.route}${s.app ? ` app=${s.app}` : ""}${s.pid != null ? ` pid=${s.pid}` : ""}]`;
  const note = s.fallbackReason ? `\n${s.fallbackReason}` : "";
  if (s.elements.length === 0) {
    return `${head}${note}\n（无编号元素。先检查 permissions，或改用 screenshot。）`;
  }
  const body = s.elements.map(lineElement).join("\n");
  return `${head}${note}\n先看再动：后续 click/type 用 target='[N]'，并带上 snapshot。\n${body}`;
}

export function formatApps(apps: DesktopApp[]): string {
  if (!apps.length) return "（没有可见应用）";
  return apps
    .map((a) => {
      const front = a.frontmost ? " frontmost" : "";
      const bid = a.bundleId ? ` ${a.bundleId}` : "";
      return `${a.name} pid=${a.pid}${bid}${front}`;
    })
    .join("\n");
}

export function formatWindows(windows: DesktopWindow[]): string {
  if (!windows.length) return "（没有可见窗口）";
  return windows
    .map((w) => `${w.app ?? "?"} — ${w.title || "(untitled)"}${w.pid != null ? ` pid=${w.pid}` : ""}`)
    .join("\n");
}

export function formatPermissions(p: ComputerPermissions): string {
  const row = (ok: boolean, name: string, hint?: string) =>
    `${ok ? "ok" : "missing"} ${name}${!ok && hint ? `\n  ${hint}` : ""}`;
  return [
    row(p.ax, "辅助功能（控件树）", p.axHint),
    row(p.screen, "屏幕录制（截图/抽帧）", p.screenHint),
    row(p.input, "键鼠模拟（CGEvent）"),
  ].join("\n");
}

export function formatAvailability(a: Availability): string {
  return [
    `platform=${a.platform}`,
    `helper=${a.helper}${a.helperPath ? ` ${a.helperPath}` : ""}`,
    `ax=${a.ax} screen=${a.screen} input=${a.input}`,
  ].join("\n");
}

export function formatHelp(): string {
  return [
    "use_computer 控制本机桌面 App（不是浏览器；网页用 use_browser）。",
    "流程：permissions → activate → snapshot → click/type target='[N]'。",
    "路线：auto 先走系统控件树；失败可降级截图/抽帧 + 坐标。可锁 ax / pixels。",
    "观察：snapshot, screenshot, record, apps, windows, permissions。",
    "动作：click, type, press, scroll, hotkey, set-value, activate。",
  ].join("\n");
}
