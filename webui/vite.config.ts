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
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/client/index.html"),
        draft: resolve(__dirname, "src/client/draft.html"),
      },
    },
  },
});
