/**
 * GET/PUT /api/config/llm — LLM presets + Agent roles (template defaults)
 * POST /api/config/llm/test — 真实 chat 探测 + 延迟
 * POST /api/config/llm/svg-probe — 无上下文 SVG 降智探针 + 画廊
 */

import type { Express } from "express";
import {
  testConnection,
  runModelSvgProbe,
  DEFAULT_SVG_PROBE_SUBJECT,
} from "@little-house-studio/llm";
import {
  loadLlmConfigSnapshot,
  resolvePresetForConnectionTest,
  saveLlmConfigFromClient,
  type LlmConfigPresetWrite,
  type LlmConfigRoles,
} from "./llm-config.js";
import {
  listSvgProbeGallery,
  loadReference,
  saveSvgProbeShot,
  setSvgProbeReference,
} from "./model-svg-probe-store.js";
import { parseLlmClipboardText } from "./paste-parse.js";

export function mountLlmConfigRoutes(app: Express): void {
  app.get("/api/config/llm", (_req, res) => {
    try {
      const snap = loadLlmConfigSnapshot();
      res.json({ ok: true, ...snap });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 测试 LLM API 是否可调用（真实 chat 请求）。
   * body: { name?, url?, model?, key?, protocol?, vendor?, urlParams?, timeoutMs? }
   * key 省略时用磁盘已保存密钥。
   */
  app.post("/api/config/llm/test", async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        name?: string;
        url?: string;
        model?: string;
        key?: string;
        protocol?: string;
        vendor?: string;
        urlParams?: string;
        maxTokens?: number;
        maxContext?: number;
        timeoutMs?: number;
        probeMessage?: string;
      };
      const preset = resolvePresetForConnectionTest(body);
      if (!String(preset.url ?? "").trim()) {
        res.status(400).json({ ok: false, error: "url required" });
        return;
      }
      if (!String(preset.model ?? "").trim()) {
        res.status(400).json({ ok: false, error: "model required" });
        return;
      }
      if (!String(preset.key ?? "").trim()) {
        res.status(400).json({
          ok: false,
          error: "API key 未设置（请先填写密钥或保存过密钥）",
        });
        return;
      }

      const result = await testConnection(preset, {
        timeoutMs:
          typeof body.timeoutMs === "number" && body.timeoutMs > 0
            ? Math.min(body.timeoutMs, 120_000)
            : 30_000,
        probeMessage: body.probeMessage,
      });

      res.json({
        ok: result.ok,
        result,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 模型降智体感探针：无上下文要求输出 SVG → 解析为图片 → 写入画廊。
   * body 同 test + subject?
   */
  app.post("/api/config/llm/svg-probe", async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        name?: string;
        url?: string;
        model?: string;
        key?: string;
        protocol?: string;
        vendor?: string;
        urlParams?: string;
        maxTokens?: number;
        maxContext?: number;
        timeoutMs?: number;
        subject?: string;
      };
      const preset = resolvePresetForConnectionTest(body);
      if (!String(preset.url ?? "").trim()) {
        res.status(400).json({ ok: false, error: "url required" });
        return;
      }
      if (!String(preset.model ?? "").trim()) {
        res.status(400).json({ ok: false, error: "model required" });
        return;
      }
      if (!String(preset.key ?? "").trim()) {
        res.status(400).json({
          ok: false,
          error: "API key 未设置（请先填写密钥或保存过密钥）",
        });
        return;
      }

      const result = await runModelSvgProbe(preset, {
        subject: body.subject,
        timeoutMs:
          typeof body.timeoutMs === "number" && body.timeoutMs > 0
            ? Math.min(body.timeoutMs, 180_000)
            : 90_000,
        maxTokens:
          typeof body.maxTokens === "number" && body.maxTokens > 0
            ? body.maxTokens
            : 4096,
      });

      const shot = saveSvgProbeShot(result, {
        presetName: String(body.name ?? preset.name ?? "").trim() || "preset",
      });
      const reference = loadReference(result.model, shot.presetName);

      // 业务失败也返回 HTTP 200，但必须带可读 error（禁止前端退化成 "http 200"）
      const businessOk = Boolean(result.ok && result.extracted);
      res.json({
        ok: businessOk,
        error: businessOk
          ? undefined
          : result.error ||
            "模型未返回可解析的 SVG（通道可能正常，但未画出图）",
        result: {
          ...result,
          // 给 UI 的摘要，避免只显示状态码
          summary: businessOk
            ? `画图成功 · ${result.latencyMs}ms`
            : `请求已通 · ${result.latencyMs}ms · 未抽出图`,
        },
        shot,
        reference,
        defaultSubject: DEFAULT_SVG_PROBE_SUBJECT,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** 画廊 + 当前 model 的标准参考 */
  app.get("/api/config/llm/svg-probe/gallery", (req, res) => {
    try {
      const model = String(req.query.model ?? "").trim() || undefined;
      const presetName = String(req.query.presetName ?? "").trim() || undefined;
      const limit = Number(req.query.limit);
      const data = listSvgProbeGallery({
        model,
        presetName,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json({ ok: true, ...data, defaultSubject: DEFAULT_SVG_PROBE_SUBJECT });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** 将某次 shot 设为标准参考图 */
  app.post("/api/config/llm/svg-probe/reference", (req, res) => {
    try {
      const shotId = String((req.body ?? {}).shotId ?? "").trim();
      if (!shotId) {
        res.status(400).json({ ok: false, error: "shotId required" });
        return;
      }
      const reference = setSvgProbeReference(shotId);
      res.json({ ok: true, reference });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 粘贴识别 → 表单字段。不写 config.json。
   * body: { text: string }
   */
  app.post("/api/config/llm/parse", async (req, res) => {
    try {
      const text = String((req.body ?? {}).text ?? (req.body ?? {}).raw ?? "");
      if (!text.trim()) {
        res.status(400).json({ ok: false, error: "text required" });
        return;
      }
      const parsed = await parseLlmClipboardText(text);
      res.json({ ok: true, ...parsed });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.put("/api/config/llm", (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        presets?: LlmConfigPresetWrite[];
        defaultPreset?: number;
        roles?: LlmConfigRoles;
        replace?: boolean;
      };
      if (!Array.isArray(body.presets)) {
        res.status(400).json({ ok: false, error: "presets array required" });
        return;
      }
      for (const p of body.presets) {
        if (!p || typeof p !== "object") {
          res.status(400).json({ ok: false, error: "invalid preset row" });
          return;
        }
        if (!String(p.name ?? "").trim()) {
          res.status(400).json({ ok: false, error: "preset.name required" });
          return;
        }
        if (!String(p.url ?? "").trim()) {
          res.status(400).json({ ok: false, error: "preset.url required" });
          return;
        }
        if (!String(p.model ?? "").trim()) {
          res.status(400).json({ ok: false, error: "preset.model required" });
          return;
        }
      }
      const snap = saveLlmConfigFromClient({
        presets: body.presets,
        defaultPreset:
          typeof body.defaultPreset === "number"
            ? body.defaultPreset
            : undefined,
        roles: body.roles,
        replace: body.replace !== false,
      });
      res.json({ ok: true, ...snap });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
