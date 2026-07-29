/**
 * ThreeFilterPipeline — high-performance GPU post filter for three.js.
 *
 * Path: scene → WebGLRenderTarget → clip-space ShaderMaterial quad → screen
 * Modes: off | dither | ascii | both
 */

import * as THREE from "three";
import { buildGlyphAtlas } from "./ascii-atlas";
import { FILTER_PALETTE } from "../theme";

export type FilterMode = "off" | "dither" | "ascii" | "both";

export interface ThreeFilterOptions {
  cellW?: number;
  cellH?: number;
  color?: boolean;
  contrast?: number;
  brightness?: number;
  paper?: string;
  ink?: string;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tGlyphs;
uniform vec2 uResolution;
uniform vec2 uCell;
uniform float uCols;
uniform float uMode;
uniform float uColor;
uniform float uContrast;
uniform float uBrightness;
uniform vec3 uPaper;
uniform vec3 uInk;

varying vec2 vUv;

float lum3(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float bayer4(vec2 p) {
  float x = floor(mod(p.x, 4.0));
  float y = floor(mod(p.y, 4.0));
  float i = x + y * 4.0;
  if (i < 0.5) return 0.0;
  if (i < 1.5) return 0.5;
  if (i < 2.5) return 0.125;
  if (i < 3.5) return 0.625;
  if (i < 4.5) return 0.75;
  if (i < 5.5) return 0.25;
  if (i < 6.5) return 0.875;
  if (i < 7.5) return 0.375;
  if (i < 8.5) return 0.1875;
  if (i < 9.5) return 0.6875;
  if (i < 10.5) return 0.0625;
  if (i < 11.5) return 0.5625;
  if (i < 12.5) return 0.9375;
  if (i < 13.5) return 0.4375;
  if (i < 14.5) return 0.8125;
  return 0.3125;
}

void main() {
  vec2 uv = vUv;
  vec4 src = texture2D(tDiffuse, uv);

  if (uMode < 0.5) {
    gl_FragColor = src;
    return;
  }

  vec2 res = max(uResolution, vec2(1.0));
  vec2 frag = uv * res;
  vec2 cellSize = max(uCell, vec2(2.0));
  vec2 cellId = floor(frag / cellSize);
  vec2 cellCenter = (cellId + 0.5) * cellSize / res;

  vec3 acc = vec3(0.0);
  vec2 dlt = cellSize / res / 3.0;
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 o = (vec2(float(i), float(j)) - 1.0) * dlt;
      acc += texture2D(tDiffuse, clamp(cellCenter + o, 0.0, 1.0)).rgb;
    }
  }
  acc *= 0.11111111;

  float L = lum3(acc);
  L = pow(clamp(L, 0.0, 1.0), 0.65);
  L = clamp(L * uContrast + uBrightness, 0.0, 1.0);

  float modeDither = 0.0;
  float modeAscii = 0.0;
  if (uMode > 0.5 && uMode < 1.5) modeDither = 1.0;
  if (uMode > 1.5 && uMode < 2.5) modeAscii = 1.0;
  if (uMode > 2.5) {
    modeDither = 1.0;
    modeAscii = 1.0;
  }

  if (modeAscii < 0.5) {
    float thr = bayer4(frag);
    float bit = L >= thr ? 1.0 : 0.0;
    vec3 paper = uPaper;
    if (uColor > 0.5) {
      paper = clamp(mix(acc * 1.4, uPaper, 0.35), 0.0, 1.0);
    }
    gl_FragColor = vec4(mix(uInk, paper, bit), 1.0);
    return;
  }

  float cols = max(uCols, 2.0);
  float Lf = L;
  if (modeDither > 0.5) {
    Lf = clamp(L + (bayer4(cellId) - 0.5) * 0.14, 0.0, 1.0);
  }
  float idx = floor(Lf * (cols - 1.001));
  vec2 local = fract(frag / cellSize);
  float gu = (idx + local.x) / cols;
  float gv = local.y;
  float g = texture2D(tGlyphs, vec2(gu, gv)).r;

  vec3 fg = uPaper;
  if (uColor > 0.5) {
    fg = mix(uPaper, clamp(acc * 1.35, 0.0, 1.0), 0.55);
  }
  gl_FragColor = vec4(mix(uInk, fg, g), 1.0);
}
`;

const MODE_NUM: Record<FilterMode, number> = {
  off: 0,
  dither: 1,
  ascii: 2,
  both: 3,
};

/**
 * High-performance three.js post filter (Bayer + ASCII).
 * This is the library's main realtime filter API.
 */
export class ThreeFilterPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private rt: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private quadScene: THREE.Scene;
  private quadCam: THREE.OrthographicCamera;
  private glyph: ReturnType<typeof buildGlyphAtlas>;
  private mode: FilterMode = "dither";
  private disposed = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: ThreeFilterOptions = {},
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    renderer.debug.checkShaderErrors = true;

    const w = Math.max(1, renderer.domElement.width || 2);
    const h = Math.max(1, renderer.domElement.height || 2);

    this.rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.rt.texture.colorSpace = THREE.NoColorSpace;
    this.rt.texture.generateMipmaps = false;

    this.glyph = buildGlyphAtlas();

    this.mat = new THREE.ShaderMaterial({
      name: "CanvasUiThreeFilter",
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tGlyphs: { value: this.glyph.texture },
        uResolution: { value: new THREE.Vector2(w, h) },
        uCell: {
          value: new THREE.Vector2(opts.cellW ?? 8, opts.cellH ?? 12),
        },
        uCols: { value: this.glyph.cols },
        uMode: { value: MODE_NUM.dither },
        uColor: { value: opts.color === false ? 0 : 1 },
        uContrast: { value: opts.contrast ?? 1.35 },
        uBrightness: { value: opts.brightness ?? 0.12 },
        uPaper: {
          value: new THREE.Color(opts.paper ?? FILTER_PALETTE.paper),
        },
        uInk: { value: new THREE.Color(opts.ink ?? FILTER_PALETTE.ink) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const geo = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(geo, this.mat);
    quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setMode(mode: FilterMode) {
    this.mode = mode;
    this.mat.uniforms.uMode!.value = MODE_NUM[mode];
  }

  getMode() {
    return this.mode;
  }

  setCellSize(cw: number, ch?: number) {
    (this.mat.uniforms.uCell!.value as THREE.Vector2).set(
      cw,
      ch ?? Math.round(cw * 1.5),
    );
  }

  setColor(on: boolean) {
    this.mat.uniforms.uColor!.value = on ? 1 : 0;
  }

  setContrast(v: number) {
    this.mat.uniforms.uContrast!.value = v;
  }

  setBrightness(v: number) {
    this.mat.uniforms.uBrightness!.value = v;
  }

  setPalette(paper: string, ink: string) {
    (this.mat.uniforms.uPaper!.value as THREE.Color).set(paper);
    (this.mat.uniforms.uInk!.value as THREE.Color).set(ink);
  }

  setSize(width: number, height: number, dpr = 1) {
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    this.rt.setSize(w, h);
    (this.mat.uniforms.uResolution!.value as THREE.Vector2).set(w, h);
    this.mat.uniforms.tDiffuse!.value = this.rt.texture;
  }

  /** Call once per frame */
  render() {
    if (this.disposed) return;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;

    if (this.mode === "off") {
      r.setRenderTarget(null);
      r.autoClear = true;
      r.setClearColor(0x3a3228, 1);
      r.render(this.scene, this.camera);
      r.autoClear = prevAuto;
      r.setRenderTarget(prev);
      return;
    }

    r.setRenderTarget(this.rt);
    r.autoClear = true;
    r.setClearColor(0x3a3228, 1);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);

    this.mat.uniforms.tDiffuse!.value = this.rt.texture;
    r.setRenderTarget(null);
    r.autoClear = true;
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(this.quadScene, this.quadCam);

    r.autoClear = prevAuto;
    r.setRenderTarget(prev);
  }

  dispose() {
    this.disposed = true;
    this.rt.dispose();
    this.mat.dispose();
    this.glyph.texture.dispose();
    this.quadScene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

/** @deprecated use ThreeFilterPipeline */
export const AsciiDitherPipeline = ThreeFilterPipeline;
export type AsciiMode = FilterMode;
