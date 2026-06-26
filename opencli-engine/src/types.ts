/**
 * opencli-engine 类型定义
 */

export interface OpencliEnvelope {
  matches_n?: number;
  match_level?: "exact" | "stable" | "reidentified";
  clicked?: boolean;
  typed?: boolean;
  text?: string;
  autocomplete?: boolean;
  filled?: boolean;
  verified?: boolean;
  actual?: string;
  selected?: { label: string; value: string };
  value?: unknown;
  title?: string;
  url?: string;
  error?: { code: string; message: string; hint?: string; candidates?: string[]; available?: string[] };
  content?: string;
  total_chars?: number;
  next_start_char?: number | null;
  entries?: Array<Record<string, unknown>>;
  tabs?: Array<{ index: number; page: string; url: string; title: string; active: boolean }>;
  page?: string;
  sessions?: Array<{ workspace: string; idleMsRemaining: number | null }>;
  compound?: Record<string, unknown>;
  compounds?: Record<string, Record<string, unknown>>;
  target?: string;
  targetId?: string;
  image?: string;
}

/** 多步执行的单步定义 */
export interface MultiStep {
  session?: string;
  action: string;
  target?: string;
  text?: string;
  js?: string;
  url?: string;
  tab?: string;
  subtype?: string;
  nth?: string;
  amount?: string;
  timeout?: string;
  wait_type?: string;
  poll_interval?: string;
  continue_on_error?: boolean;
  watch_target?: string;
  watch_type?: "change" | "text" | "selector" | "value";
  extract_js?: string;
}

export interface MultiResult {
  step: number;
  session: string;
  action: string;
  success: boolean;
  message: string;
  data?: unknown;
}

/** 引擎统一返回结构 */
export interface EngineResult {
  ok: boolean;
  /** 最终格式化（含截断）的展示文本 */
  message: string;
  payload: Record<string, unknown>;
  /** screenshot 无 path 时返回的 base64 */
  imageBase64?: string;
}
