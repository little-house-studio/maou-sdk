"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("maouApp", {
  kind: "desktop",
  platform: process.platform,
  httpStart: (req) => ipcRenderer.invoke("app:http-start", req),
  httpAbort: (id) => ipcRenderer.send("app:http-abort", id),
  onHttpChunk: (id, cb) => {
    const ch = `app:http-chunk:${id}`;
    const fn = (_e, chunk) => cb(chunk);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  onHttpEnd: (id, cb) => {
    const ch = `app:http-end:${id}`;
    const fn = () => cb();
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  onHttpError: (id, cb) => {
    const ch = `app:http-error:${id}`;
    const fn = (_e, message) => cb(message);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  wsOpen: (id, url) => ipcRenderer.send("app:ws-open", id, url),
  wsSend: (id, data) => ipcRenderer.send("app:ws-send", id, data),
  wsClose: (id) => ipcRenderer.send("app:ws-close", id),
  onWsMessage: (id, cb) => {
    const ch = `app:ws-msg:${id}`;
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
});
