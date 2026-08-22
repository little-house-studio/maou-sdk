/**
 * sqry-engine 类型定义
 */

/** 单个符号条目 */
export interface SqryEntry {
  name: string;
  qualifiedName?: string;
  kind?: string;
  file: string;
  line?: number;
  [key: string]: unknown;
}

/** search 结果 */
export interface SqrySearchResult {
  entries: SqryEntry[];
  totalMatches: number;
  execMs?: number | string;
  /** JSON 解析失败时的原始文本降级 */
  rawText?: string;
  isJson: boolean;
}

/** graph 类结果（callers/callees/path/hierarchy/subgraph/explain） */
export interface SqryGraphResult {
  entries: SqryEntry[];
  totalFound: number;
  /** 当只有 stats/metadata 无 entries 时的原始对象 */
  raw?: unknown;
  /** 非 JSON 时的原始文本 */
  rawText?: string;
  isJson: boolean;
}

/** 纯文本结果（cycles/unused/impact/duplicates） */
export interface SqryTextResult {
  text: string;
}

/** sqry 未安装 */
export class SqryNotInstalledError extends Error {
  constructor() {
    super("sqry 未安装。请运行: cargo install sqry");
    this.name = "SqryNotInstalledError";
  }
}

/** 索引构建失败 */
export class SqryIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqryIndexError";
  }
}

/** 符号歧义（多个定义） */
export class SqryAmbiguousError extends Error {
  constructor(public symbol: string, public stderr: string) {
    super(`符号 "${symbol}" 存在多个定义`);
    this.name = "SqryAmbiguousError";
  }
}
