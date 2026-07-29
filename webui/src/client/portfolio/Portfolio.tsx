/**
 * canvas-ui 完整案例
 *
 * 演示库的全部能力：
 *  1. ThreeFilterPipeline — GPU Bayer / ASCII 后处理
 *  2. CanvasUi — 像素 HUD（叠在 3D 之上的 2D 层）
 *  3. applyOrderedDither — CPU 有序抖动（侧栏小预览）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  applyOrderedDither,
  CANVAS_UI_NAME,
  CANVAS_UI_VERSION,
  CanvasUi,
  GALLERY_THEME,
  ThreeFilterPipeline,
  type FilterMode,
  fillRect,
  pixelText,
} from "../canvas-ui";
import { createGalleryScene } from "./scene";
import { ARTIST, WORKS } from "./works";
import "./portfolio.css";

type DemoTab = "gpu" | "hud" | "api";

const FILTER_MODES: { id: FilterMode; label: string; key: string }[] = [
  { id: "off", label: "Clean (off)", key: "1" },
  { id: "dither", label: "Bayer dither", key: "2" },
  { id: "ascii", label: "ASCII", key: "3" },
  { id: "both", label: "ASCII + dither", key: "4" },
];

export function Portfolio() {
  const hostRef = useRef<HTMLDivElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const cpuPreviewRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<FilterMode>("dither");
  const [color, setColor] = useState(true);
  const [cell, setCell] = useState(8);
  const [contrast, setContrast] = useState(1.35);
  const [brightness, setBrightness] = useState(0.12);
  const [fps, setFps] = useState(0);
  const [tab, setTab] = useState<DemoTab>("gpu");
  const [hudLog, setHudLog] = useState("* CANVAS-UI READY");
  const activeRef = useRef(0);
  const pipelineRef = useRef<ThreeFilterPipeline | null>(null);
  const uiRef = useRef(new CanvasUi(GALLERY_THEME));

  const work = WORKS[active] ?? WORKS[0]!;

  const select = useCallback((i: number) => {
    const n = ((i % WORKS.length) + WORKS.length) % WORKS.length;
    activeRef.current = n;
    setActive(n);
  }, []);

  // —— GPU three filter demo ——
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
      depth: true,
    });
    renderer.debug.checkShaderErrors = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x3a3228, 1);
    renderer.domElement.className = "portfolio-canvas";
    host.appendChild(renderer.domElement);

    const gallery = createGalleryScene();
    gallery.setActive(activeRef.current);

    const filter = new ThreeFilterPipeline(
      renderer,
      gallery.scene,
      gallery.camera,
      { cellW: cell, cellH: Math.round(cell * 1.5), color },
    );
    filter.setMode(mode);
    pipelineRef.current = filter;

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.max(1, cr.width);
      const h = Math.max(1, cr.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      gallery.camera.aspect = w / h;
      gallery.camera.updateProjectionMatrix();
      filter.setSize(w, h, dpr);
    });
    ro.observe(host);

    const rect = host.getBoundingClientRect();
    {
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      gallery.camera.aspect = w / Math.max(1, h);
      gallery.camera.updateProjectionMatrix();
      filter.setSize(w, h, dpr);
    }

    let raf = 0;
    let frames = 0;
    let fpsT = performance.now();
    const clock = new THREE.Clock();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = clock.getDelta();
      const t = clock.elapsedTime;
      gallery.setActive(activeRef.current);
      gallery.update(t, dt);
      filter.render();
      frames++;
      if (now - fpsT > 500) {
        setFps(Math.round((frames * 1000) / (now - fpsT)));
        frames = 0;
        fpsT = now;
      }
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        select(activeRef.current + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        select(activeRef.current - 1);
      } else if (e.key === "1") setMode("off");
      else if (e.key === "2") setMode("dither");
      else if (e.key === "3") setMode("ascii");
      else if (e.key === "4") setMode("both");
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      filter.dispose();
      gallery.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement);
      }
      pipelineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  useEffect(() => {
    pipelineRef.current?.setMode(mode);
  }, [mode]);
  useEffect(() => {
    pipelineRef.current?.setColor(color);
  }, [color]);
  useEffect(() => {
    pipelineRef.current?.setCellSize(cell);
  }, [cell]);
  useEffect(() => {
    pipelineRef.current?.setContrast(contrast);
  }, [contrast]);
  useEffect(() => {
    pipelineRef.current?.setBrightness(brightness);
  }, [brightness]);

  // —— CanvasUi HUD demo (2D overlay) ——
  useEffect(() => {
    if (tab !== "hud") return;
    const canvas = hudCanvasRef.current;
    if (!canvas) return;
    const ui = uiRef.current;
    let raf = 0;
    let tick = 0;

    ui.setClickHandler((id) => {
      if (id === "atk") setHudLog("* ATK CLICK");
      else if (id === "item") setHudLog("* ITEM CLICK");
      else if (id === "rest") setHudLog("* REST CLICK");
      else setHudLog(`* ${id.toUpperCase()}`);
    });

    const resize = () => {
      const parent = canvas.parentElement;
      const w = Math.max(320, parent?.clientWidth || 640);
      const h = Math.max(240, parent?.clientHeight || 400);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const scalePos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / Math.max(1, rect.width);
      const sy = canvas.height / Math.max(1, rect.height);
      return {
        x: (e.clientX - rect.left) * sx,
        y: (e.clientY - rect.top) * sy,
      };
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = scalePos(e);
      ui.setPointer(x, y, e.buttons === 1);
    };
    const onDown = (e: PointerEvent) => {
      const { x, y } = scalePos(e);
      ui.setPointer(x, y, true);
    };
    const onUp = (e: PointerEvent) => {
      const { x, y } = scalePos(e);
      ui.setPointer(x, y, false);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      tick++;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      // low-res feel via internal scale
      const s = Math.max(1, Math.floor((window.devicePixelRatio || 1) > 1.5 ? 2 : 1));
      const lw = Math.floor(w / s);
      const lh = Math.floor(h / s);

      // draw to offscreen at 1x logical then scale — simple: draw at canvas res with pixel sizes * s
      fillRect(ctx, 0, 0, w, h, GALLERY_THEME.bg);
      // floor grid
      for (let y = 40 * s; y < h; y += 16 * s) {
        for (let x = 0; x < w; x += 16 * s) {
          fillRect(
            ctx,
            x,
            y,
            16 * s,
            16 * s,
            (x / s + y / s) % 32 < 16 ? "#2c2418" : "#32281c",
          );
        }
      }
      // torch
      const flicker = 4 + (tick % 3);
      fillRect(ctx, 48 * s, 80 * s, 8 * s, flicker * s, "#e09030");
      fillRect(ctx, 50 * s, 76 * s, 4 * s, 6 * s, "#f0d060");

      ui.beginFrame();
      // hit-test coords must match draw coords (canvas pixel space)
      // scale UI to s
      const panel = (x: number, y: number, pw: number, ph: number, title?: string) => {
        ui.panel(ctx, { x: x * s, y: y * s, w: pw * s, h: ph * s }, title);
      };
      // buttons need unscaled hit regions relative to pointer which is in canvas pixels
      // So draw with canvas pixels directly:
      ui.panel(ctx, { x: 8 * s, y: 4 * s, w: w - 16 * s, h: 28 * s }, "CANVAS-UI HUD");
      pixelText(ctx, "HP 72", 16 * s, 22 * s, "#c85840", s);
      ui.bar(ctx, { x: 56 * s, y: 12 * s, w: 80 * s, h: 10 * s }, 0.72, "#a84838");
      pixelText(ctx, "MP 40", 150 * s, 22 * s, "#6890a0", s);
      ui.bar(ctx, { x: 190 * s, y: 12 * s, w: 60 * s, h: 10 * s }, 0.4, "#5080a0");

      ui.button(ctx, "atk", { x: 12 * s, y: h - 36 * s, w: 56 * s, h: 22 * s }, "ATK");
      ui.button(ctx, "item", { x: 76 * s, y: h - 36 * s, w: 56 * s, h: 22 * s }, "ITEM");
      ui.button(ctx, "rest", { x: 140 * s, y: h - 36 * s, w: 56 * s, h: 22 * s }, "REST");

      ui.panel(ctx, { x: w - 160 * s, y: 40 * s, w: 148 * s, h: 80 * s }, "LOG");
      pixelText(ctx, hudLog.slice(0, 18), w - 148 * s, 68 * s, GALLERY_THEME.muted, s);
      pixelText(ctx, `T ${tick}`, w - 148 * s, 84 * s, GALLERY_THEME.muted, s);

      void panel;
      void lw;
      void lh;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [tab, hudLog]);

  // —— CPU dither mini preview ——
  useEffect(() => {
    const c = cpuPreviewRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#c4783a");
    g.addColorStop(0.5, "#3a3228");
    g.addColorStop(1, "#e8e2d6");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d4a574";
    ctx.beginPath();
    ctx.arc(w * 0.55, h * 0.45, 28, 0, Math.PI * 2);
    ctx.fill();
    applyOrderedDither(ctx, w, h, { levels: 4 });
  }, [tab]);

  const snippet = useMemo(() => {
    return `import {
  ThreeFilterPipeline,
  CanvasUi,
  applyOrderedDither,
} from "canvas-ui";

// GPU (three.js)
const filter = new ThreeFilterPipeline(renderer, scene, camera, {
  cellW: ${cell},
  color: ${color},
});
filter.setMode("${mode}");
filter.setContrast(${contrast.toFixed(2)});
filter.setBrightness(${brightness.toFixed(2)});
filter.render(); // each frame

// Canvas2D HUD
const ui = new CanvasUi();
ui.panel(ctx, { x: 8, y: 8, w: 120, h: 40 }, "STATUS");
ui.button(ctx, "ok", { x: 8, y: 56, w: 48, h: 16 }, "OK");

// CPU dither
applyOrderedDither(ctx, w, h);`;
  }, [cell, color, mode, contrast, brightness]);

  return (
    <div className="portfolio">
      <aside className="portfolio-rail">
        <div className="portfolio-mark">
          {CANVAS_UI_NAME} · v{CANVAS_UI_VERSION}
        </div>
        <h1 className="portfolio-name">canvas-ui</h1>
        <p className="portfolio-role">Pixel HUD · Bayer · ASCII · three.js</p>
        <p className="portfolio-tagline">
          完整案例：GPU 滤镜管线 + Canvas2D 组件 + CPU dither 预览。
        </p>

        <div className="cui-tabs">
          {(
            [
              ["gpu", "GPU Filter"],
              ["hud", "Canvas HUD"],
              ["api", "API"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "gpu" && (
          <>
            <nav className="portfolio-nav" aria-label="Works">
              {WORKS.map((w, i) => (
                <button
                  key={w.id}
                  type="button"
                  className={i === active ? "active" : ""}
                  onClick={() => select(i)}
                >
                  <span className="idx">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {w.title}
                </button>
              ))}
            </nav>

            <div className="portfolio-controls">
              <label>
                ThreeFilterPipeline.setMode
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as FilterMode)}
                >
                  {FILTER_MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.key}: {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                setCellSize({cell})
                <input
                  type="range"
                  min={4}
                  max={16}
                  step={1}
                  value={cell}
                  onChange={(e) => setCell(Number(e.target.value))}
                />
              </label>
              <label>
                setContrast({contrast.toFixed(2)})
                <input
                  type="range"
                  min={0.6}
                  max={2.2}
                  step={0.05}
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                />
              </label>
              <label>
                setBrightness({brightness.toFixed(2)})
                <input
                  type="range"
                  min={0}
                  max={0.4}
                  step={0.02}
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                />
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={color}
                  onChange={(e) => setColor(e.target.checked)}
                />
                setColor(true)
              </label>
            </div>
          </>
        )}

        {tab === "hud" && (
          <div className="portfolio-controls">
            <p style={{ margin: 0, lineHeight: 1.5, color: "#9a8a70" }}>
              <code>CanvasUi</code> 像素面板 / 按钮 / 条。点击底部 ATK · ITEM ·
              REST。
            </p>
            <p style={{ margin: 0, fontFamily: "monospace", fontSize: 11 }}>
              log: {hudLog}
            </p>
          </div>
        )}

        {tab === "api" && (
          <div className="portfolio-controls">
            <p style={{ margin: 0, lineHeight: 1.5, color: "#9a8a70" }}>
              库入口 <code>src/client/canvas-ui</code>
            </p>
            <canvas
              ref={cpuPreviewRef}
              width={200}
              height={80}
              className="cui-cpu-preview"
              title="applyOrderedDither preview"
            />
            <span style={{ fontSize: 10 }}>CPU applyOrderedDither</span>
          </div>
        )}
      </aside>

      <div className="portfolio-stage">
        {/* GPU stage always mounted so filter stays warm; hide when other tabs */}
        <div
          ref={hostRef}
          className="portfolio-stage-host"
          style={{ display: tab === "gpu" ? "block" : "none" }}
        />
        {tab === "hud" && (
          <canvas ref={hudCanvasRef} className="portfolio-canvas cui-hud-canvas" />
        )}
        {tab === "api" && (
          <pre className="cui-snippet">{snippet}</pre>
        )}
        {tab === "gpu" && (
          <>
            <div className="portfolio-fps">
              {fps ? `${fps} fps · ThreeFilterPipeline` : "…"}
            </div>
            <div className="portfolio-hint">↑↓ / J K · 1–4 mode</div>
          </>
        )}
      </div>

      <aside className="portfolio-detail">
        {tab === "gpu" && (
          <>
            <div className="portfolio-year">
              DEMO · GPU · {mode.toUpperCase()}
            </div>
            <h2 className="portfolio-title">{work.title}</h2>
            <p className="portfolio-medium">{work.medium}</p>
            <p className="portfolio-blurb">{work.blurb}</p>
            <div className="portfolio-meta">
              <div>
                <strong>ThreeFilterPipeline</strong>
                <br />
                scene → RT → fullscreen shader
                <br />
                no getImageData · Bayer + glyph atlas
              </div>
              <div style={{ marginTop: 12 }}>
                {ARTIST.location}
                <br />
                filter path: canvas-ui/dither/three-filter.ts
              </div>
            </div>
          </>
        )}
        {tab === "hud" && (
          <>
            <div className="portfolio-year">DEMO · Canvas2D</div>
            <h2 className="portfolio-title">CanvasUi</h2>
            <p className="portfolio-medium">panel · button · bar · pixelText</p>
            <p className="portfolio-blurb">
              像素风 HUD 组件，与滤镜库同包。可单独用于 2D 游戏 / 工具界面，也可叠在
              three 画布之上。
            </p>
            <div className="portfolio-meta">
              theme: GALLERY_THEME
              <br />
              hit-test: setPointer / setClickHandler
            </div>
          </>
        )}
        {tab === "api" && (
          <>
            <div className="portfolio-year">REFERENCE</div>
            <h2 className="portfolio-title">Exports</h2>
            <p className="portfolio-blurb">
              CanvasUi, ThreeFilterPipeline, applyOrderedDither, pixelText,
              GALLERY_THEME, FILTER_PALETTE, ASCII_RAMP, BAYER4…
            </p>
            <div className="portfolio-meta">
              详见 canvas-ui/README.md
              <br />
              版本 {CANVAS_UI_VERSION}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
