/** 简易行级 diff（LCS），供 copilot / 对齐展示 */

import type { DiffLine } from "./types";

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.replace(/\r\n/g, "\n").split("\n");
  const b = newText.replace(/\r\n/g, "\n").split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oi = 1;
  let ni = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "equal", text: a[i]!, oldLine: oi, newLine: ni });
      i++;
      j++;
      oi++;
      ni++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "del", text: a[i]!, oldLine: oi });
      i++;
      oi++;
    } else {
      out.push({ type: "add", text: b[j]!, newLine: ni });
      j++;
      ni++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i]!, oldLine: oi });
    i++;
    oi++;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j]!, newLine: ni });
    j++;
    ni++;
  }
  return out;
}
