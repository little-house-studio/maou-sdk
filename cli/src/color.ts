/** 颜色工具 —— hex 解析 / 线性插值 / 渐变色阶（供 Gradient/Sparkline/Focus 复用） */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 两色之间线性插值，t∈[0,1] */
export function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** 在多个色站之间生成 n 个均匀渐变色 */
export function gradientStops(stops: string[], n: number): string[] {
  if (n <= 0) return [];
  if (stops.length === 0) return new Array(n).fill("#ffffff");
  if (stops.length === 1) return new Array(n).fill(stops[0]!);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = n === 1 ? 0 : (i / (n - 1)) * (stops.length - 1);
    const lo = Math.floor(p);
    const hi = Math.min(stops.length - 1, lo + 1);
    out.push(lerpColor(stops[lo]!, stops[hi]!, p - lo));
  }
  return out;
}
