import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "src/client"),
  base: "/",
  server: {
    port: 5173,
    proxy: {
      // 必须带尾斜杠 / 用 ^/api/，否则会把源码模块 /api.ts 也代理到后端 → 404 白屏
      "/api/": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
});
