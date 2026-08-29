import { BrowserWindow, dialog, ipcMain, shell } from "electron";

export function bindFolderIpc(): () => void {
  ipcMain.handle("app:pick-folder", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const r = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { path: null };
    return { path: r.filePaths[0] };
  });
  ipcMain.handle("app:reveal-in-folder", async (_e, p: string) => {
    const path = String(p ?? "").trim();
    if (!path) return { ok: false };
    shell.showItemInFolder(path);
    return { ok: true };
  });
  ipcMain.handle("app:open-path", async (_e, p: string) => {
    const path = String(p ?? "").trim();
    if (!path) return { ok: false };
    const err = await shell.openPath(path);
    return { ok: !err, error: err || undefined };
  });
  return () => {
    ipcMain.removeHandler("app:pick-folder");
    ipcMain.removeHandler("app:reveal-in-folder");
    ipcMain.removeHandler("app:open-path");
  };
}
