/** Shared ask preview text. Message tree writes it; rail only reads it. */

export const ASK_PREVIEW_MAX = 200;

export function clipAskPreview(
  text: string | undefined | null,
  max = ASK_PREVIEW_MAX,
): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const budget = Math.max(8, max);
  if (t.length <= budget) return t;
  return `${t.slice(0, budget - 1)}…`;
}
