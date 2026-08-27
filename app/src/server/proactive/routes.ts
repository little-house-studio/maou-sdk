/**
 * 主动智能 HTTP 壳 —— 业务在 Agent 层 ProactiveService（附属驻扎）
 */

import type { Express } from "express";
import {
  isQueued,
  type ProactiveService,
} from "@little-house-studio/agent";

export function mountProactiveRoutes(
  app: Express,
  getService: () => ProactiveService,
): void {
  app.get("/api/proactive", (_req, res) => {
    try {
      res.json({ ok: true, ...getService().snapshot() });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/proactive/board", (_req, res) => {
    try {
      res.json({ ok: true, board: getService().getBoard() });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.put("/api/proactive/board", (req, res) => {
    try {
      const raw = req.body?.raw != null ? String(req.body.raw) : null;
      if (raw == null) {
        res.status(400).json({ ok: false, error: "raw required" });
        return;
      }
      const board = getService().saveBoardRaw(raw);
      res.json({ ok: true, board });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.patch("/api/proactive/items/:id", (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ ok: false, error: "id required" });
        return;
      }
      const svc = getService();
      if (req.body?.queue != null) {
        svc.setItemQueue(id, Boolean(req.body.queue));
      }
      if (req.body?.done != null) {
        svc.setItemDoneFlag(id, Boolean(req.body.done));
      }
      res.json({ ok: true, board: svc.getBoard() });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/proactive/settings", (_req, res) => {
    try {
      res.json({ ok: true, settings: getService().getSettings() });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.put("/api/proactive/settings", (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (body.enabled != null) patch.enabled = Boolean(body.enabled);
      if (body.frequency != null) patch.frequency = String(body.frequency);
      if (body.intervalMinutes != null) {
        patch.intervalMinutes = Number(body.intervalMinutes);
      }
      if (body.maxRunsPerDay != null) {
        patch.maxRunsPerDay = Number(body.maxRunsPerDay);
      }
      if (Array.isArray(body.autoZones)) {
        patch.autoZones = body.autoZones.map(String);
      }
      getService().setSettings(patch);
      res.json({ ok: true, ...getService().snapshot() });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/proactive/scan", async (req, res) => {
    try {
      const autoDispatch = req.body?.autoDispatch === true;
      const svc = getService();
      void svc.runScan({
        reason: autoDispatch ? "manual_auto" : "manual",
        autoDispatch,
      });
      await new Promise((r) => setTimeout(r, 20));
      res.json({ ok: true, ...svc.snapshot() });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/proactive/dispatch", async (req, res) => {
    try {
      const svc = getService();
      let ids = Array.isArray(req.body?.itemIds)
        ? (req.body.itemIds as unknown[]).map(String)
        : Array.isArray(req.body?.ids)
          ? (req.body.ids as unknown[]).map(String)
          : [];
      if (
        req.body?.queuedOnly === true ||
        (!ids.length && req.body?.allQueued)
      ) {
        ids = svc
          .getBoard()
          .items.filter((i) => !i.done && isQueued(i))
          .map((i) => i.id);
      }
      if (!ids.length) {
        res.status(400).json({ ok: false, error: "itemIds required" });
        return;
      }
      void svc.runDispatch(ids, { auto: Boolean(req.body?.auto) });
      await new Promise((r) => setTimeout(r, 20));
      res.json({ ok: true, ...svc.snapshot() });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/proactive/abort", (_req, res) => {
    try {
      getService().abort();
      res.json({ ok: true, ...getService().snapshot() });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/proactive/chat", async (req, res) => {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ ok: false, error: "message required" });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const write = (obj: unknown) => {
      if (res.writableEnded) return;
      try {
        res.write(`${JSON.stringify(obj)}\n`);
      } catch {
        /* ignore */
      }
    };
    try {
      for await (const ev of getService().chatStream(message)) {
        if (res.writableEnded || req.aborted) break;
        write(ev);
      }
      write({ type: "done" });
    } catch (e) {
      write({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
}
