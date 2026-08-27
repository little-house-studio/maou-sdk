import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "src/client"),
  base: "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // 必须用 /api/（带尾斜杠），否则会把源码模块 /api.ts 也代理到后端 → 404 白屏
      "/api/": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/ws": { target: "ws://127.0.0.1:8787", ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
    modulePreload: {
      // Only preload deps of the entry module graph — never force heavy
      // editor/terminal chunks into first paint via multi-page shared chunks.
      resolveDependencies: (filename, deps) => {
        return deps.filter((d) => {
          const base = d.split("/").pop() || d;
          if (/codemirror|SourceEditor|TerminalPanel|xterm|MarkdownWorkbench/i.test(base)) {
            return false;
          }
          return true;
        });
      },
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/client/index.html"),
        draft: resolve(__dirname, "src/client/draft.html"),
      },
      output: {
        /**
         * Only pure node_modules — never app source. Putting SourceEditor /
         * TerminalPanel here previously pulled react into those chunks, so
         * main statically imported ./codemirror-*.js just to get react.
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }
          if (
            id.includes("@codemirror") ||
            id.includes("@uiw/react-codemirror")
          ) {
            return "codemirror";
          }
          if (id.includes("@xterm")) {
            return "xterm";
          }
        },
      },
    },
  },
});
