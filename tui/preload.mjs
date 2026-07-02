// Unified preload: registers tsx's loader AND a bun-stub, using Node's
// module.registerHooks (synchronous, runs before ESM async hooks).
//
// Usage: node --import ./preload.mjs src/probe.ts
//
// We avoid `npx tsx` entirely so we control hook ordering: our stub hooks
// wrap tsx's hooks. We import tsx's internal register via the public
// `tsx/esm/api` -> `register`, which installs tsx's resolve/load hooks.
// Then we register OUR hooks AFTER tsx, so (registerHooks is LIFO) OUR
// hooks run FIRST and short-circuit "bun"/"bun:ffi" before tsx ever sees
// them — preventing tsx's sync hook from throwing ERR_MODULE_NOT_FOUND.

import { registerHooks } from "node:module";
import { register } from "node:module";

// ---- 0. Install a global `Bun` shim ------------------------------------
// Pi TUI / pi-utils source references a bare `Bun` global (e.g.
// `Bun.env`, `Bun.spawnSync`) in addition to `import { ... } from "bun"`.
// Our loader hooks stub the `import "bun"` form; here we provide the global
// so bare `Bun.xxx` references don't throw ReferenceError at runtime.
//
// CRITICAL: Bun.stringWidth is implemented here for real (not a no-op).
// Pi's visibleWidth() calls Bun.stringWidth(str, {countAnsiEscapeCodes:false,
// ambiguousIsNarrow:true}) for EVERY non-ASCII render path (Text wrap,
// Markdown layout, ScrollView sizing). Without it, any CJK / emoji content
// crashes the whole TUI. We build it from get-east-asian-width (already a
// dependency) + an ANSI/OSC stripper matching Bun's countAnsiEscapeCodes:false.

// Eagerly load the width table so stringWidth is sync.
let _eastAsianWidth = null;
try {
  _eastAsianWidth = (await import("get-east-asian-width")).eastAsianWidth;
} catch {
  _eastAsianWidth = null;
}

// Matches CSI (ESC [ ... letter), OSC (ESC ] ... BEL/ST), and common single-
// char ESC sequences that Bun.stringWidth strips to zero width when
// countAnsiEscapeCodes is false. ST is ESC \ (0x1b 0x5c).
const ANSI_ESCAPE_RE = /\x1b\[[0-9;:?<=>!"#$%&'()*+,\-./]*[A-Za-z@]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>78NXME_Z^_()*+]/g;

/**
 * Replicate Bun.stringWidth(str, opts): visible cell width.
 * - countAnsiEscapeCodes:false → strip all CSI/OSC/ESC sequences first.
 * - ambiguousIsNarrow:true → eastAsianWidth(cp, {ambiguousAsWide:false}).
 * Zero-width: combining marks (Mn/Me/Cf), ZWJ/ZWNJ, variation selectors,
 * most control chars. Wide (2): fullwidth/wide per UAX#11.
 */
function piStringWidth(str, opts) {
  if (typeof str !== "string" || str.length === 0) return 0;
  const stripAnsi = !opts || opts.countAnsiEscapeCodes === false;
  let s = stripAnsi ? str.replace(ANSI_ESCAPE_RE, "") : str;
  if (!_eastAsianWidth) {
    // Fallback: byte-ish count of non-control chars (ASCII-correct only).
    let n = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp < 0x20 || cp === 0x7f) continue;
      n++;
    }
    return n;
  }
  let width = 0;
  // Iterate by code point (for..of handles surrogate pairs).
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    // C0/C1 controls: zero width.
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;
    // Zero-width joiners / non-joiners / variation selectors.
    if (cp === 0x200d || cp === 0x200c) continue;
    if (cp >= 0xfe00 && cp <= 0xfe0f) continue; // VS1-VS16
    if (cp >= 0xe0100 && cp <= 0xe01ef) continue; // VS17-VS256
    // Combining diacritical marks (0x300-0x36f) and a chunk of common
    // combining ranges: treat as zero-width (Bun does via UAX#11 neutral).
    // eastAsianWidth returns 1 for neutral; we override known zero-width.
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    if (cp >= 0x1ab0 && cp <= 0x1aff) continue;
    if (cp >= 0x1dc0 && cp <= 0x1dff) continue;
    if (cp >= 0x20d0 && cp <= 0x20ff) continue;
    if (cp >= 0xfe20 && cp <= 0xfe2f) continue;
    width += _eastAsianWidth(cp, { ambiguousAsWide: false });
  }
  return width;
}

if (typeof globalThis.Bun === "undefined") {
  const BunShim = {
    env: process.env,
    spawn: () => ({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }),
    spawnSync: () => ({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }),
    write: async () => 0,
    file: () => ({ text: async () => "", bytes: async () => new Uint8Array(), size: 0 }),
    serve: () => ({ stop: () => {}, ref: () => {}, unref: () => {} }),
    gzipSync: (b) => b,
    gunzipSync: (b) => b,
    deflateSync: (b) => b,
    inflateSync: (b) => b,
    argv: process.argv.slice(2),
    cwd: () => process.cwd(),
    main: process.argv[1],
    // Real implementation — see comment above. Without this, visibleWidth()
    // crashes on any non-ASCII content and the TUI cannot render CJK/emoji.
    stringWidth: piStringWidth,
  };
  globalThis.Bun = new Proxy(BunShim, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      // Unknown Bun property: return a no-op function that also acts as
      // an empty object/iterable. This keeps eval-time reads from throwing.
      return undefined;
    },
  });
} else if (typeof globalThis.Bun.stringWidth !== "function") {
  // Real Bun present but missing stringWidth (shouldn't happen) — patch it.
  globalThis.Bun.stringWidth = piStringWidth;
}

// ---- 1. Install tsx's TypeScript transpilation hooks -------------------
// tsx's `register` (exported from tsx/esm/api) installs its resolve+load
// hooks via module.register (worker-thread based) OR module.registerHooks
// (sync, when available). It picks the sync path automatically on Node 22+.
let tsxReady = false;
try {
  // The `register` export from tsx/esm/api accepts { namespace, tsconfig }.
  // Calling with no args installs global hooks.
  const tsxApi = await import("tsx/esm/api");
  if (typeof tsxApi.register === "function") {
    tsxApi.register({ tsconfig: false });
    tsxReady = true;
  }
} catch (e) {
  // If tsx can't register here, fall back to letting the user invoke via tsx.
  process.stderr.write(`[preload] tsx register failed: ${e?.message}\n`);
}

// ---- 2. Bun stub source ------------------------------------------------
const BUN_STUB = `
export const YAML = {
  parse: (s) => { try { return JSON.parse(s); } catch { return {}; } },
  stringify: (v) => JSON.stringify(v),
};
export const Glob = class {
  constructor() {}
  *[Symbol.iterator]() {}
};
export const dlopen = (name, def) => {
  const symbols = {};
  for (const k of Object.keys(def || {})) symbols[k] = () => undefined;
  return { symbols, close: () => {} };
};
export const FFIType = {
  i32: "i32", i64: "i64", f64: "f64", ptr: "ptr", cstring: "cstring",
  u8: "u8", u16: "u16", u32: "u32", void: "void",
};
export const ptr = (v) => (v == null ? null : v);
export class CString {
  constructor(buf, offset = 0) { this.buf = buf; this.offset = offset; }
  toString() { return ""; }
}
export const plugin = () => {};
export default {
  env: process.env,
  spawn: () => ({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }),
  spawnSync: () => ({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }),
  write: async () => 0,
  file: () => ({ text: async () => "", bytes: async () => new Uint8Array() }),
  Glob, YAML, plugin, dlopen, FFIType, ptr, CString,
};
`;

const STUB_URL_PREFIX = "pi-bun-stub:";

// ---- 3. Register OUR hooks (LIFO: run before tsx) ----------------------
// registerHooks uses synchronous hooks. resolve receives (specifier, context,
// nextResolve). We short-circuit bun specifiers; delegate everything else.
//
// We ALSO rewrite the pi-natives loader source on the fly: it uses
// `import.meta.dir` (a Bun-only property that is `undefined` in Node, which
// crashes path.join). We replace it with a Node-compatible shim derived from
// import.meta.url, so pi-natives' loader-state.js can compute nativeDir.
if (typeof registerHooks === "function") {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "bun" || specifier === "bun:ffi") {
        return { url: STUB_URL_PREFIX + specifier, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(STUB_URL_PREFIX)) {
        return {
          format: "module",
          source: BUN_STUB,
          shortCircuit: true,
        };
      }
      const result = nextLoad(url, context);
      // Patch pi-natives' loader-state.js: replace `import.meta.dir` with a
      // Node-compatible value (dirname of fileURLToPath(import.meta.url)).
      // The file is plain JS (not TS), so a string replace is safe.
      if (
        typeof url === "string" &&
        url.includes("@oh-my-pi+pi-natives") &&
        url.includes("loader-state.js")
      ) {
        // nextLoad may return a source string or a getter; normalize.
        const src =
          typeof result.source === "string"
            ? result.source
            : result.source
            ? String(result.source)
            : null;
        if (src && src.includes("import.meta.dir")) {
          // Define __dirname-equivalent from import.meta.url at top, then
          // swap the usage. Using a const avoids re-evaluating fileURLToPath.
          const patched =
            "import { fileURLToPath as __pi_fileURLToPath } from 'node:url';\n" +
            "import { dirname as __pi_dirname } from 'node:path';\n" +
            "const __pi_importMetaDir = __pi_dirname(__pi_fileURLToPath(import.meta.url));\n" +
            src.replace(/import\.meta\.dir/g, "__pi_importMetaDir");
          result.source = patched;
        }
      }
      return result;
    },
  });
}
