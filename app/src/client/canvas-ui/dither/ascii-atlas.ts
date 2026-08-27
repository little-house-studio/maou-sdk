/**
 * ASCII density ramp + glyph atlas texture builder (for GPU filter).
 */

import * as THREE from "three";

/** Light → dark ink density */
export const ASCII_RAMP =
  " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

export function buildGlyphAtlas(ramp: string = ASCII_RAMP): {
  texture: THREE.DataTexture;
  cols: number;
  charW: number;
  charH: number;
} {
  const charW = 8;
  const charH = 12;
  const cols = ramp.length;
  const canvas = document.createElement("canvas");
  canvas.width = cols * charW;
  canvas.height = charH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${charH - 1}px "Fusion Pixel 12 Mono"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < ramp.length; i++) {
    ctx.fillText(ramp[i]!, i * charW + charW * 0.5, charH * 0.5);
  }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const texture = new THREE.DataTexture(
    img.data,
    canvas.width,
    canvas.height,
    THREE.RGBAFormat,
  );
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  return { texture, cols, charW, charH };
}
