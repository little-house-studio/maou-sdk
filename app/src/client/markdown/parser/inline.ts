/** 行内 Markdown → InlineMark[]（粗/斜/删/代码/链接，可嵌套粗斜） */

import type { InlineMark } from "./types";

export function parseInlines(input: string): InlineMark[] {
  const s = input;
  const out: InlineMark[] = [];
  let i = 0;
  let buf = "";

  const flush = () => {
    if (buf) {
      out.push({ type: "text", text: buf });
      buf = "";
    }
  };

  while (i < s.length) {
    // `code`
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ type: "code", text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // ***bold italic*** or **bold** or *em* or ~~del~~
    if (s.startsWith("***", i) || s.startsWith("___", i)) {
      const end = s.indexOf(s.slice(i, i + 3), i + 3);
      if (end > i) {
        flush();
        out.push({
          type: "strong",
          children: [
            {
              type: "em",
              children: parseInlines(s.slice(i + 3, end)),
            },
          ],
        });
        i = end + 3;
        continue;
      }
    }
    if (s.startsWith("**", i) || s.startsWith("__", i)) {
      const mark = s.slice(i, i + 2);
      const end = s.indexOf(mark, i + 2);
      if (end > i) {
        flush();
        out.push({
          type: "strong",
          children: parseInlines(s.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }
    if (s.startsWith("~~", i)) {
      const end = s.indexOf("~~", i + 2);
      if (end > i) {
        flush();
        out.push({
          type: "del",
          children: parseInlines(s.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }
    if (
      (s[i] === "*" || s[i] === "_") &&
      s[i + 1] !== s[i] &&
      s[i + 1] !== undefined
    ) {
      const mark = s[i]!;
      const end = s.indexOf(mark, i + 1);
      if (end > i) {
        flush();
        out.push({
          type: "em",
          children: parseInlines(s.slice(i + 1, end)),
        });
        i = end + 1;
        continue;
      }
    }
    // [text](url)
    if (s[i] === "[") {
      const close = s.indexOf("]", i + 1);
      if (close > i && s[close + 1] === "(") {
        const closeP = s.indexOf(")", close + 2);
        if (closeP > close) {
          flush();
          out.push({
            type: "link",
            href: s.slice(close + 2, closeP),
            children: parseInlines(s.slice(i + 1, close)),
          });
          i = closeP + 1;
          continue;
        }
      }
    }
    buf += s[i];
    i += 1;
  }
  flush();
  return out.length ? out : [{ type: "text", text: "" }];
}

export function inlinesToPlain(marks: InlineMark[]): string {
  let t = "";
  for (const m of marks) {
    if (m.type === "text" || m.type === "code") t += m.text;
    else if (m.type === "link") t += inlinesToPlain(m.children);
    else t += inlinesToPlain(m.children);
  }
  return t;
}
