/**
 * 防傻瓜能力校验（Guardrails）
 *
 * 在 ChatSession.send/sendStream 入口处调用，发送前校验请求与模型能力是否匹配。
 * 目标：让 SDK 用户少踩坑，遇到"模型不支持图片但发了图片"这类情况时，
 * 给出明确的提示和降级处理，而不是默默发出去等厂商 API 报 400。
 *
 * 设计原则：
 * - 纯函数，零副作用（不 console.warn，由调用方决定怎么处理 warnings）
 * - 致命错误（preset 缺字段等）返回 ok=false + error，由调用方 throw
 * - 非致命问题（能力不匹配）返回 warnings + sanitizedAttachments，调用方决定是否 warn + 用处理后的数据
 * - base64 校验用正则，性能优于 try-catch Buffer
 */

import type { APIPreset } from "./adapters/types.js";
import type { Attachment } from "./chat-session.js";

/** 校验结果 */
export interface GuardrailResult {
  /** true = 可以发送；false = 致命错误，调用方应 throw error */
  ok: boolean;
  /** 致命错误描述（ok=false 时有值） */
  error?: string;
  /** 非致命警告（ok=true 时可能有，调用方应 console.warn） */
  warnings: string[];
  /** 处理后的 attachments（image 降级为 text 占位等） */
  sanitizedAttachments?: Attachment[];
  /** 处理后的 reasoning level（模型不支持时强制 'off'） */
  sanitizedReasoningLevel?: string;
  /** 处理后的 toolSchemas（模型不支持工具调用时为空数组） */
  sanitizedToolSchemas?: unknown[];
}

/** 合法 base64 字符正则（标准 base64 + URL-safe base64，允许换行/空白） */
const BASE64_RE = /^[A-Za-z0-9+/\-_=\s]+$/;

/** 判断字符串是否像合法 base64（快速校验，非密码学严格） */
function looksLikeBase64(s: string): boolean {
  if (!s || s.length === 0) return false;
  // 去掉所有空白后检查字符集
  const cleaned = s.replace(/\s/g, "");
  if (cleaned.length === 0) return false;
  return BASE64_RE.test(cleaned);
}

/** 本地模型（如 ollama）不需要 key */
function isLocalModel(preset: APIPreset): boolean {
  const url = String(preset.url ?? "").toLowerCase();
  return url.includes("localhost") || url.includes("127.0.0.1") || url.includes("0.0.0.0");
}

/**
 * 校验发送前的请求。
 *
 * @returns GuardrailResult。调用方应根据 ok 决定是否 throw，根据 warnings 决定是否 console.warn。
 */
export function validateRequest(params: {
  preset: APIPreset;
  text: string;
  attachments?: Attachment[];
  reasoningLevel?: string;
  toolSchemas?: unknown[];
}): GuardrailResult {
  const { preset, text, attachments, reasoningLevel, toolSchemas } = params;
  const warnings: string[] = [];

  // ── 致命错误：preset 缺关键字段 ──

  if (!preset.url) {
    return { ok: false, error: "preset.url is required（请检查 preset 配置）", warnings };
  }
  if (!preset.model) {
    return { ok: false, error: "preset.model is required（请检查 preset 配置）", warnings };
  }
  if (!preset.key && !isLocalModel(preset)) {
    return {
      ok: false,
      error: `preset.key is required（模型 ${preset.model} 需要认证。本地模型如 ollama 可忽略此检查，但 url 须含 localhost）`,
      warnings,
    };
  }

  // ── 致命错误：消息内容为空 ──

  const hasText = text && text.trim().length > 0;
  const hasAttachments = attachments && attachments.length > 0;
  if (!hasText && !hasAttachments) {
    return { ok: false, error: "消息内容不能为空（text 和 attachments 至少要有一个）", warnings };
  }

  // ── 附件校验 ──

  const sanitizedAttachments: Attachment[] = [];
  const supportsVision = preset.supportsVision !== false; // 默认 true（未配置视为支持）
  let visionDowngraded = false;

  if (attachments) {
    for (const att of attachments) {
      // 未知类型：warn + 忽略
      if (!["image", "video", "audio", "document"].includes(att.type)) {
        warnings.push(`忽略未知类型的附件：type="${att.type}"（合法值：image/video/audio/document）`);
        continue;
      }

      // base64 校验
      if (!att.data || !looksLikeBase64(att.data)) {
        return {
          ok: false,
          error: `附件 "${att.name ?? att.type}" 的 data 不是合法 base64 编码`,
          warnings,
        };
      }

      // mimeType 与 type 不一致：warn（不阻断）
      if (att.mimeType && !att.mimeType.toLowerCase().startsWith(`${att.type}/`)) {
        warnings.push(
          `附件 "${att.name ?? att.type}" 的 mimeType "${att.mimeType}" 与 type "${att.type}" 不匹配（建议检查）`,
        );
      }

      // vision 能力门控：image 附件 + 模型不支持 vision
      if (att.type === "image" && !supportsVision && !visionDowngraded) {
        visionDowngraded = true;
        warnings.push(
          `模型 ${preset.model} 不支持图片输入（supportsVision=false），图片附件将转为文本描述。如需图片识别，请换用支持 vision 的模型。`,
        );
        // 转文本占位
        sanitizedAttachments.push({
          type: "image",
          data: att.data,
          mimeType: att.mimeType,
          name: att.name,
        });
        continue;
      }

      sanitizedAttachments.push(att);
    }
  }

  // ── reasoning 能力门控 ──

  let sanitizedReasoningLevel = reasoningLevel;
  const supportsReasoning = (preset as Record<string, unknown>).supportsReasoning !== false;
  if (reasoningLevel && reasoningLevel !== "off" && !supportsReasoning) {
    warnings.push(
      `模型 ${preset.model} 不支持推理/思考（supportsReasoning=false），reasoning level 已强制关闭。`,
    );
    sanitizedReasoningLevel = "off";
  }

  // ── 工具调用能力门控 ──

  let sanitizedToolSchemas = toolSchemas;
  const nativeToolCalling = preset.nativeToolCalling !== false; // 默认 true
  if (toolSchemas && toolSchemas.length > 0 && !nativeToolCalling) {
    warnings.push(
      `模型 ${preset.model} 不支持原生工具调用（nativeToolCalling=false），toolSchemas 将被丢弃。`,
    );
    sanitizedToolSchemas = [];
  }

  return {
    ok: true,
    warnings,
    sanitizedAttachments: sanitizedAttachments.length > 0 || hasAttachments ? sanitizedAttachments : undefined,
    sanitizedReasoningLevel,
    sanitizedToolSchemas,
  };
}
