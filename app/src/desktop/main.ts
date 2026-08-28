import { app, BrowserWindow, Menu, dialog, nativeImage } from "electron";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppServer } from "../server/create-server.js";
import { resolveAppIcon } from "./icon.js";
import { bindAppHttpIpc } from "./ipc-http.js";
import { bindAppWsIpc } from "./ipc-ws.js";
import { appPlatform } from "./platforms/index.js";
import { createAppWindow } from "./window.js";

const here = dirname(fileURLToPath(import.meta.url));
app.setName("Maou");
process.stdout.write("[maou-app] main loaded\n");

function rendererDevUrl(): string | undefined {
  const fromEnv = process.env.MAOU_APP_RENDERER_URL?.trim();
  if (fromEnv) return fromEnv;
  if (!app.isPackaged) return "http://127.0.0.1:5173/";
  return undefined;
}

function rendererFile(): string | undefined {
  if (app.isPackaged) {
    return join(process.resourcesPath, "app", "dist", "client", "index.html");
  }
  const built = join(here, "../../dist/client/index.html");
  return existsSync(built) ? built : undefined;
}

function preloadPath(): string {
  const candidates = [
    join(process.cwd(), "src/desktop/preload.cjs"),
    join(process.cwd(), "dist/desktop/preload.cjs"),
    join(here, "preload.cjs"),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(`preload.cjs not found (${candidates.join(", ")})`);
  }
  return hit;
}

function openWindow() {
  const platform = appPlatform();
  return createAppWindow({
    platform,
    preload: preloadPath(),
    rendererUrl: rendererDevUrl(),
    rendererFile: rendererDevUrl() ? undefined : rendererFile(),
  });
}

function applyDockIcon() {
  const path = resolveAppIcon();
  if (!path) return;
  const image = nativeImage.createFromPath(path);
  if (image.isEmpty()) return;
  app.dock?.setIcon(image);
}

async function boot() {
  const platform = appPlatform();
  await app.whenReady();
  applyDockIcon();

  const socketPath = platform.ipcPath(app.getPath("userData"), process.pid);
  if (!socketPath.startsWith("\\\\.\\pipe\\")) {
    mkdirSync(dirname(socketPath), { recursive: true });
    if (existsSync(socketPath)) unlinkSync(socketPath);
  }

  const projectRoot = process.env.MAOU_PROJECT_ROOT?.trim() || process.cwd();
  const server = createAppServer({
    listen: { kind: "socket", path: socketPath },
    projectRoot,
    sandboxMode: process.env.MAOU_SANDBOX_MODE || "yolo",
  });
  await server.start();

  const unbindHttp = bindAppHttpIpc(socketPath);
  const unbindWs = bindAppWsIpc(server);

  const accel = platform.accel;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          ...(accel.hide
            ? [{ role: "hide" as const, accelerator: accel.hide }]
            : []),
          { role: "quit", accelerator: accel.quit },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

  const preload = preloadPath();
  process.stdout.write(
    `[maou-app] desktop ${platform.id} ipc=${socketPath}\n` +
      `[maou-app] preload ${preload}\n`,
  );
  openWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });

  const shutdown = async () => {
    unbindHttp();
    unbindWs();
    await server.close();
    if (!socketPath.startsWith("\\\\.\\pipe\\") && existsSync(socketPath)) {
      try {
        unlinkSync(socketPath);
      } catch {
        /* ignore */
      }
    }
  };

  app.on("before-quit", (e) => {
    e.preventDefault();
    void shutdown().finally(() => {
      app.exit(0);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  const win = BrowserWindow.getAllWindows()[0];
  win?.webContents.on("unresponsive", () => {
    if (!win) return;
    void dialog.showMessageBox(win, {
      type: "warning",
      message: "Maou App 窗口无响应",
    });
  });
}

boot().catch((err) => {
  console.error("[maou-app]", err);
  app.exit(1);
});
