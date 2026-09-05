/**
 * Split a markdown source into top-level blocks that parse the same alone as
 * they do inside the whole document.
 *
 * Why: while a reply streams, every frame re-parses the entire body. With the
 * body cut into blocks, only the tail block changes per frame; the earlier
 * blocks are memoized React subtrees. react-markdown (v10) renders a fragment
 * with a "\n" text node between top-level blocks, so N instances joined by
 * "\n" produce the identical DOM — verified by markdown-blocks.test.ts on
 * full documents and on streaming prefixes.
 *
 * Rules are deliberately conservative: when unsure, do not split there; when
 * the document contains any construct whose meaning depends on text outside
 * its own block, do not split at all (return null).
 */

/** Constructs that reach across blank lines / blocks → render as one piece. */
const UNSAFE_PATTERNS: readonly RegExp[] = [
  // Link reference definitions and footnote definitions ([id]: … / [^id]: …)
  /^ {0,3}\[[^\]\n]*\]:/m,
  // Footnote references — remark-gfm collects them document-wide
  /\[\^/,
  // HTML block kinds 1–5 may contain blank lines until their end condition
  /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/im,
  /^ {0,3}<!--/m,
  /^ {0,3}<\?/m,
  /^ {0,3}<![A-Za-z]/m,
  /^ {0,3}<!\[CDATA\[/m,
];

export function markdownSplitUnsafe(text: string): boolean {
  return UNSAFE_PATTERNS.some((re) => re.test(text));
}

/** Any indentation counts as a fence — over-matching only suppresses splits. */
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
/** Bullet / ordered marker, with or without content ("-" alone is an empty item). */
const LIST_MARKER = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

/**
 * Blocks separated at blank lines that sit outside fenced code and are
 * followed by a column-0 line. Returns null when splitting is unsafe or
 * yields a single block (caller renders the whole source then).
 *
 * Lists: a blank line followed by another list marker keeps the SAME list
 * going as a loose list (every item gets a <p>). Splitting there would turn
 * it into two tight lists, so once a chunk contains a list marker we never
 * cut in front of a marker line — the list ends only at non-list content.
 */
export function splitMarkdownBlocks(text: string): string[] | null {
  if (!text || markdownSplitUnsafe(text)) return null;
  const lines = text.split("\n");
  const blocks: string[] = [];
  let start = 0;
  let fence: { ch: string; len: number } | null = null;
  let listOpen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { ch: open[1]![0]!, len: open[1]!.length };
      continue;
    }
    if (line.trim() !== "") {
      if (LIST_MARKER.test(line)) listOpen = true;
      continue;
    }

    // Blank line outside a fence. Look at the next non-blank line.
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    if (j >= lines.length) break; // trailing blanks stay with the last block
    const next = lines[j]!;
    // Indented continuation (list item body, indented code) keeps its block.
    if (!/^\S/.test(next)) continue;
    // Same list continuing across the blank line (loose list) — keep it whole.
    if (listOpen && LIST_MARKER.test(next)) continue;

    const chunk = lines.slice(start, i).join("\n");
    if (chunk.trim() !== "") blocks.push(chunk);
    start = j;
    i = j - 1;
    listOpen = false;
  }

  const tail = lines.slice(start).join("\n");
  if (tail.trim() !== "" || blocks.length === 0) blocks.push(tail);
  return blocks.length > 1 ? blocks : null;
}
