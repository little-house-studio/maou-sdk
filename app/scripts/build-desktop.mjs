import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(fileURLToPath(import.meta.url));
const appRoot = join(root, "..");
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

await esbuild.build({
  entryPoints: [join(appRoot, "src/desktop/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(appRoot, "dist/desktop/main.js"),
  packages: "external",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});

mkdirSync(join(appRoot, "dist/desktop"), { recursive: true });
copyFileSync(
  join(appRoot, "src/desktop/preload.cjs"),
  join(appRoot, "dist/desktop/preload.cjs"),
);
