/** Bayer ordered-dither matrices */

export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export function bayer4Threshold(x: number, y: number): number {
  return (BAYER4[y & 3]![x & 3]! + 0.5) / 16;
}
