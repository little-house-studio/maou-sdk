export type CaretBox = { left: number; top: number; bottom: number };

const MIRROR_STYLE = [
  "direction",
  "boxSizing",
  "width",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
] as const;

/** 文本框里某个下标（如 `/`）在视口中的盒子。 */
export function textareaIndexRect(
  el: HTMLTextAreaElement,
  index: number,
): CaretBox {
  const cs = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  mirror.setAttribute("data-composer-caret-mirror", "");
  for (const key of MIRROR_STYLE) {
    mirror.style[key] = cs[key];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "anywhere";
  mirror.style.height = "auto";
  mirror.style.width = `${el.clientWidth}px`;
  const before = el.value.slice(0, Math.max(0, index));
  const ch = el.value.slice(Math.max(0, index), Math.max(0, index) + 1) || "/";
  mirror.appendChild(document.createTextNode(before));
  const mark = document.createElement("span");
  mark.textContent = ch;
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const host = el.getBoundingClientRect();
  const box = mark.getBoundingClientRect();
  const origin = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);
  const left = host.left + (box.left - origin.left) - el.scrollLeft;
  const top = host.top + (box.top - origin.top) - el.scrollTop;
  return { left, top, bottom: top + box.height };
}
