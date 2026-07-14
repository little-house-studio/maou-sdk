# @little-house-studio/term-raster

Optional **Rust N-API** accelerator for maou CLI paint path.

- **Does not replace Ink/React components** — only `encode + line-diff + ANSI assemble`.
- **Does not touch agent** packages.
- Missing `.node` binary → CLI automatically falls back to pure JS (`vram-layer.ts`).

## Build

```bash
cd cli/native/term-raster
npm install
npm run build
```

Requires Rust (`rustc`/`cargo`) and Node ≥ 20.

## Disable

```bash
MAOU_NATIVE=0 maou coding
```

## API

- `paintDiff(frame, themeBgSgr, prevLines, forceAll)` → `{ lines, out, dirty, native }`
- `rasterVersion()` → crate version string
