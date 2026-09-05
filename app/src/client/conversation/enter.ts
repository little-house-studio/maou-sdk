import { useLayoutEffect, useRef, useState } from "react";

/** Class on a newly sent user turn. */
export const MSG_ENTER_CLASS = "is-enter";
export const MSG_ENTER_MS = 280;
/** First-send / new-session: only a single new user id counts as enter. */
export const MSG_ENTER_MAX = 1;

export type EnterBook = {
  key: string;
  seen: ReadonlySet<string>;
};

export function emptyEnterBook(): EnterBook {
  return { key: "", seen: new Set() };
}

/**
 * User ids that appeared at the tail of this thread.
 * First paint, session replace, and older-history prepend stay quiet.
 */
export function nextEnterIds(
  prev: EnterBook,
  key: string,
  ids: readonly string[],
  primed: boolean,
): { book: EnterBook; enter: string[] } {
  if (!primed) {
    return { book: { key, seen: new Set(ids) }, enter: [] };
  }
  if (key !== prev.key) {
    const enter =
      prev.seen.size === 0 && ids.length > 0 && ids.length <= MSG_ENTER_MAX
        ? [...ids]
        : [];
    return { book: { key, seen: new Set(ids) }, enter };
  }
  const seen = new Set(prev.seen);
  const fresh = ids.filter((id) => !seen.has(id));
  for (const id of fresh) seen.add(id);
  if (fresh.length === 0) return { book: { key, seen }, enter: [] };
  let lastSeenIdx = -1;
  for (let i = ids.length - 1; i >= 0; i--) {
    if (prev.seen.has(ids[i]!)) {
      lastSeenIdx = i;
      break;
    }
  }
  const enter =
    lastSeenIdx === -1
      ? fresh
      : ids.slice(lastSeenIdx + 1).filter((id) => !prev.seen.has(id));
  return { book: { key, seen }, enter };
}

/** Live set of entering user ids; cleared after MSG_ENTER_MS. */
export function useEnterIds(
  key: string,
  ids: readonly string[],
): ReadonlySet<string> {
  const book = useRef<EnterBook>(emptyEnterBook());
  const primed = useRef(false);
  const [enter, setEnter] = useState<ReadonlySet<string>>(() => new Set());
  const sig = `${key}\n${ids.join("\n")}`;
  useLayoutEffect(() => {
    const next = nextEnterIds(book.current, key, ids, primed.current);
    primed.current = true;
    book.current = next.book;
    if (next.enter.length === 0) return;
    setEnter(new Set(next.enter));
    const t = window.setTimeout(() => setEnter(new Set()), MSG_ENTER_MS);
    return () => window.clearTimeout(t);
  }, [sig]);
  return enter;
}
