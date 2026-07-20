/**
 * Markdown 模块 · HTTP 路由
 * 挂载到 Express app（路径保持 /api/fs/* 兼容）
 */

import type { Express } from "express";
import {
  listMarkdownTree,
  readProjectFile,
  writeProjectFile,
  createMarkdownFile,
} from "./fs-api.js";

export type MarkdownRoutesOpts = {
  /** 解析项目根目录 */
  getProjectRoot: () => string;
};

export function mountMarkdownRoutes(
  app: Express,
  opts: MarkdownRoutesOpts,
): void {
  const root = () => opts.getProjectRoot();

  app.get("/api/fs/md-tree", (_req, res) => {
    try {
      const projectRoot = root();
      res.json({
        ok: true,
        root: projectRoot,
        tree: listMarkdownTree(projectRoot),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/fs/file", (req, res) => {
    const path = String(req.query.path ?? "");
    try {
      const file = readProjectFile(root(), path);
      res.json({ ok: true, ...file });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.put("/api/fs/file", (req, res) => {
    const path = String(req.body?.path ?? "");
    const content = String(req.body?.content ?? "");
    try {
      const out = writeProjectFile(root(), path, content);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/fs/file", (req, res) => {
    const path = String(req.body?.path ?? "");
    const content =
      req.body?.content != null
        ? String(req.body.content)
        : "# New document\n\n";
    try {
      const out = createMarkdownFile(root(), path, content);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
