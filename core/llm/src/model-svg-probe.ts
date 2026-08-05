/**
 * 模型「降智 / 偷换」体感探针 —— 无上下文 SVG 生成
 *
 * 目的：在零对话历史下要求模型只输出 SVG，解析后变成可渲染图片数据。
 * 用户对比「标准参考图」与本次结果，体感模型是否被换成劣质通道。
 *
 * 本模块只做：prompt 构造 / 调用 chat / 从回复抽 SVG / 转 data URL。
 * 落盘画廊与参考图由 WebUI 服务端负责。
 */

import type { APIPreset } from "./adapters/types.js";
import { LLMClient } from "./client.js";
import { normalizeApiPreset } from "./preset-normalize.js";

/** 默认题材：简单可辨、好对比「画得乱不乱」 */
export const DEFAULT_SVG_PROBE_SUBJECT =
  "一只简笔画小狗站在小舞台上，抬起一条后腿";

export interface ModelSvgProbeResult {
  ok: boolean;
  model: string;
  /** 用户题材（中文描述） */
  subject: string;
  latencyMs: number;
  firstByteMs?: number;
  httpStatus?: number | null;
  protocol?: string;
  /** 模型原始回复（截断存盘可另裁） */
  rawReply: string;
  /** 抽取出的 SVG 源码（完整） */
  svg?: string;
  /**
   * 可直接给 <img src> 的 data URL（image/svg+xml）
   * 浏览器侧渲染即「图片」；无需 canvas/PNG 转码。
   */
  imageDataUrl?: string;
  /** 是否成功抽出合法 <svg> */
  extracted: boolean;
  error?: string;
}

export interface ModelSvgProbeOptions {
  /** 自定义内容描述，默认 DEFAULT_SVG_PROBE_SUBJECT */
  subject?: string;
  /** 超时，默认 90s（生成比 ping 慢） */
  timeoutMs?: number;
  maxTokens?: number;
  client?: LLMClient;
  signal?: AbortSignal;
}

/**
 * 构造「无上下文」探针 user 消息：只要求输出 SVG，不要解释。
 */
export function buildModelSvgProbePrompt(subject: string): string {
  const s = subject.trim() || DEFAULT_SVG_PROBE_SUBJECT;
  return [
    "你是一个严格的 SVG 生成器。",
    "下面这句是唯一任务，不要使用任何外部上下文或记忆。",
    "",
    `请用纯 SVG 画出：${s}`,
    "",
    "硬性要求：",
    "1. 只输出一个完整的 <svg>...</svg> 片段，不要 Markdown 代码围栏，不要解释文字。",
    "2. viewBox 使用 0 0 480 360，宽高自洽。",
    "3. 风格：简洁卡通、颜色鲜明、一眼能看懂主体。",
    "4. 不要 <script>、不要外链图片、不要 foreignObject。",
  ].join("\n");
}

/**
 * 从模型回复中抽出 SVG（或含 svg 的简单 HTML）。
 * 兼容：裸 svg、```svg 围栏、被 <html>/<body> 包裹。
 */
export function extractSvgFromModelText(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim();
  if (!text) return null;

  // 去掉常见 markdown 围栏
  const fence = text.match(/```(?:svg|xml|html)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    text = fence[1].trim();
  }

  // 直接找 <svg ...>...</svg>
  const svgMatch = text.match(/<svg\b[\s\S]*?<\/svg>/i);
  if (svgMatch?.[0]) {
    return sanitizeSvg(svgMatch[0]);
  }

  // 残缺：有开标签无闭标签时不认
  if (/<svg\b/i.test(text) && !/<\/svg>/i.test(text)) {
    return null;
  }

  return null;
}

/** 去掉 script / 危险属性，保留可渲染形状 */
export function sanitizeSvg(svg: string): string {
  let s = svg.trim();
  // 去 script
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // 确保 xmlns，便于 data URL 独立渲染
  if (!/\sxmlns\s*=/i.test(s)) {
    s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return s;
}

/** SVG → data URL（utf-8），浏览器 <img> / CSS 可直接当图用 */
export function svgToImageDataUrl(svg: string): string {
  const clean = sanitizeSvg(svg);
  // 用 encodeURIComponent 比 base64 更稳妥处理中文/特殊字符
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
}

/**
 * 对 preset 发**无历史**单轮 chat，要求输出 SVG 并解析为图片 data URL。
 */
export async function runModelSvgProbe(
  preset: APIPreset,
  options: ModelSvgProbeOptions = {},
): Promise<ModelSvgProbeResult> {
  const model = String(preset.model ?? "").trim();
  const url = String(preset.url ?? "").trim();
  const subject =
    (options.subject ?? DEFAULT_SVG_PROBE_SUBJECT).trim().slice(0, 200) ||
    DEFAULT_SVG_PROBE_SUBJECT;

  if (!url) {
    return {
      ok: false,
      model,
      subject,
      latencyMs: 0,
      rawReply: "",
      extracted: false,
      error: "preset.url 为空",
    };
  }
  if (!model) {
    return {
      ok: false,
      model,
      subject,
      latencyMs: 0,
      rawReply: "",
      extracted: false,
      error: "preset.model 为空",
    };
  }

  const maxTok =
    typeof options.maxTokens === "number" && options.maxTokens > 0
      ? Math.min(Math.floor(options.maxTokens), 8192)
      : 4096;

  const normalized = normalizeApiPreset({
    ...preset,
    maxTokens: maxTok,
  } as APIPreset);

  const timeoutMs = options.timeoutMs ?? 90_000;
  const prompt = buildModelSvgProbePrompt(subject);
  const client = options.client ?? new LLMClient();
  const wall0 = Date.now();

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const onExternalAbort = () => timeoutCtrl.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const res = await client.chat({
      preset: normalized,
      // 无任何 system / 历史：单条 user
      messages: [{ role: "user", content: prompt }],
      jsonSettings: null,
      toolSchemas: null,
      nativeToolCalling: false,
      abortSignal: timeoutCtrl.signal,
      _logContext: { source: "model_svg_probe" },
    });

    const wallMs = Date.now() - wall0;
    const totalMs =
      res.timing?.totalMs != null && Number.isFinite(res.timing.totalMs)
        ? Math.round(res.timing.totalMs)
        : wallMs;
    const firstByteMs =
      res.firstOutputMs != null && Number.isFinite(res.firstOutputMs)
        ? Math.round(res.firstOutputMs)
        : res.timing?.firstByteMs != null &&
            Number.isFinite(res.timing.firstByteMs)
          ? Math.round(res.timing.firstByteMs)
          : undefined;

    const httpStatus = res.httpStatus;
    const rawReply = String(res.content ?? "");
    const aborted = Boolean(res.aborted);
    const httpOk =
      !aborted &&
      (httpStatus == null || (httpStatus >= 200 && httpStatus < 300));

    if (!httpOk) {
      return {
        ok: false,
        model,
        subject,
        latencyMs: totalMs,
        firstByteMs,
        httpStatus,
        protocol: res.protocol || String(normalized.protocol ?? ""),
        rawReply: rawReply.slice(0, 4000),
        extracted: false,
        error: aborted
          ? "请求已中断或超时"
          : `HTTP ${httpStatus ?? "?"} 失败`,
      };
    }

    const svg = extractSvgFromModelText(rawReply);
    if (!svg) {
      return {
        ok: false,
        model,
        subject,
        latencyMs: totalMs,
        firstByteMs,
        httpStatus: httpStatus ?? 200,
        protocol: res.protocol || String(normalized.protocol ?? ""),
        rawReply: rawReply.slice(0, 4000),
        extracted: false,
        error:
          "模型未返回可解析的 <svg>…</svg>（可能降智、拒答或只输出了说明文字）",
      };
    }

    return {
      ok: true,
      model,
      subject,
      latencyMs: totalMs,
      firstByteMs,
      httpStatus: httpStatus ?? 200,
      protocol: res.protocol || String(normalized.protocol ?? ""),
      rawReply: rawReply.slice(0, 4000),
      svg,
      imageDataUrl: svgToImageDataUrl(svg),
      extracted: true,
    };
  } catch (err) {
    const wallMs = Date.now() - wall0;
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut =
      timeoutCtrl.signal.aborted || /abort|timeout|超时/i.test(msg);
    return {
      ok: false,
      model,
      subject,
      latencyMs: wallMs,
      rawReply: "",
      extracted: false,
      error: timedOut ? `超时（${timeoutMs}ms）：${msg}` : msg,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}
