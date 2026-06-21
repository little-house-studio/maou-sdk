/**
 * 模型注册表类型定义
 *
 * 对标 pi-ai 的内置模型目录：把"模型有哪些能力、走哪个协议、什么端点、多少钱"
 * 沉淀为静态数据，配合 getModel/getModels/getProviders 提供 IDE 自动补全，
 * 并能一键转成 APIPreset 交给 LLMClient。
 */

import type { APIProtocol } from "../adapters/types.js";

/** 输入模态 */
export type InputModality = "text" | "image" | "audio" | "pdf" | "video";

/** 输出模态 */
export type OutputModality = "text" | "image" | "audio";

/** 模型定价（每百万 token，单位见 currency，默认 USD） */
export interface ModelPricing {
  /** 每百万输入 token 价格 */
  input: number;
  /** 每百万输出 token 价格 */
  output: number;
  /** 每百万缓存命中（读取）token 价格 */
  cacheRead?: number;
  /** 每百万缓存写入（创建）token 价格 */
  cacheWrite?: number;
  /** 货币单位，默认 "USD" */
  currency?: string;
}

/** 模型规格 */
export interface ModelSpec {
  /** 模型 ID（厂商 API 使用的 model 字段） */
  id: string;
  /** 所属 provider id */
  provider: string;
  /** 展示名 */
  name?: string;
  /** 走哪个协议适配器 */
  protocol: APIProtocol;
  /** 覆盖 provider 默认端点（少数模型端点不同时使用） */
  baseUrl?: string;
  /** 输入模态 */
  input: InputModality[];
  /** 输出模态 */
  output: OutputModality[];
  /** 是否支持推理/思考 */
  reasoning: boolean;
  /** 是否支持原生工具调用 */
  toolCall: boolean;
  /** 输入上下文窗口（token） */
  contextWindow?: number;
  /** 单次输出 token 上限 */
  maxTokens?: number;
  /** 定价（缺省表示未知/本地免费） */
  pricing?: ModelPricing;
  /** 知识截止（如 "2024-10"） */
  knowledge?: string;
}

/** Provider 规格 */
export interface ProviderSpec {
  /** provider id（如 "openai"） */
  id: string;
  /** 展示名（如 "OpenAI"） */
  name: string;
  /** 默认协议 */
  protocol: APIProtocol;
  /** 默认 API 端点 */
  baseUrl: string;
  /** 读取 API key 的环境变量名 */
  envKey?: string;
  /** 模型列表 */
  models: ModelSpec[];
}
