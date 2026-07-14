/**
 * OSC 8 伪超链接 —— 在不支持 OSC 22 的终端（尤其 VS Code / xterm.js）
 * 上触发「手指」鼠标指针。
 *
 * 原理：VS Code 集成终端会对 OSC 8 链接区域显示 pointer 光标
 * （与是否支持 OSC 22 无关）。我们不依赖用户真的打开链接——
 * 点击仍由 app 的 mouse reporting + useClickTarget 处理。
 *
 * 协议：`OSC 8 ; ; <uri> ST` … text … `OSC 8 ; ; ST`
 * @see https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
 */

/** 关闭：`MAOU_POINTER_LINKS=0` */
export function osc8PointerLinksEnabled(): boolean {
  if (process.env.MAOU_POINTER_LINKS === "0") return false;
  if (process.env.MAOU_POINTER === "0") return false;
  return true;
}

/**
 * 为可点击 UI 生成 URI。
 * 使用 https + 不可解析 host，保证 VS Code 允许 scheme、又不会真打开有用页面。
 */
export function clickableUri(id: string): string {
  const safe = encodeURIComponent(id.replace(/[^\w./:@-]+/g, "_")).slice(0, 180);
  return `https://maou.invalid/click/${safe}`;
}

/** 打开 OSC 8 序列（ST 终止） */
export function osc8Open(uri: string): string {
  return `\x1b]8;;${uri}\x1b\\`;
}

/** 关闭 OSC 8（结束超链接范围） */
export function osc8Close(): string {
  return `\x1b]8;;\x1b\\`;
}

/**
 * 把可见文本包进 OSC 8，使终端在 hover 时显示手型指针。
 * Ink 的 sanitize-ansi 会保留 OSC；string-width 不计入控制序列。
 */
export function wrapClickableLink(text: string, id: string): string {
  if (!text || !osc8PointerLinksEnabled()) return text;
  // 已包过则不再嵌套
  if (text.includes("\x1b]8;")) return text;
  const uri = clickableUri(id);
  return `${osc8Open(uri)}${text}${osc8Close()}`;
}

/**
 * 供 Ink `<Transform transform={...}>` 使用的工厂。
 * 在样式（颜色/粗体）应用之后再包 OSC 8，避免 chalk 插在 link 边界外。
 */
export function makeClickableTransform(id: string): (s: string) => string {
  return (s: string) => wrapClickableLink(s, id);
}
