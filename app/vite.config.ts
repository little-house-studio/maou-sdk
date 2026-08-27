import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { loadSessionToolMeta } from "./src/server/session-intents";

function writeJson(res: ServerResponse, body: unknown) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sessionIntentsDev(): Plugin {
  return {
    name: "maou-session-intents",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url || "";
        const path = raw.split("?")[0] || "";
        if (path !== "/__maou/session-intents") {
          next();
          return;
        }
        handleSessionIntents(req, res);
      });
    },
  };
}

function handleSessionIntents(req: IncomingMessage, res: ServerResponse) {
  try {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const sessionId = u.searchParams.get("sessionId") || "";
    const root = u.searchParams.get("root") || "";
    writeJson(res, loadSessionToolMeta(sessionId, root));
  } catch {
    writeJson(res, { intents: {}, durations: {} });
  }
}

/** Dev renderer is Electron-only. Browsers get 403. */
function electronOnly(): Plugin {
  return {
    name: "maou-electron-only",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0] || "";
        if (path === "/__maou/session-intents") {
          next();
          return;
        }
        const ua = String(req.headers["user-agent"] ?? "");
        if (/Electron/i.test(ua)) {
          next();
          return;
        }
        res.statusCode = 403;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Maou 只提供桌面客户端，请运行 pnpm --filter @little-house-studio/app dev\n");
      });
    },
  };
}

export default defineConfig({
  plugins: [sessionIntentsDev(), electronOnly(), react()],
  root: resolve(__dirname, "src/client"),
  base: "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: false,
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
