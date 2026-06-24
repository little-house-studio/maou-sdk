/**
 * Prompt 编译相关类型
 */

export type { PromptCompilerOptions } from "./prompt-compiler.js";

/**
 * 编译结果（含元数据，供预览渲染使用）
 */
export interface CompileResult {
  /** 编译后的最终 prompt 字符串 */
  content: string;
  /** 入口文件路径 */
  entryPath: string;
  /** 编译耗时（毫秒） */
  elapsedMs: number;
  /** 包含的文件列表（去重） */
  includedFiles: string[];
  /** 执行的脚本列表 */
  executedScripts: string[];
  /** 警告信息（如循环引用、文件未找到等） */
  warnings: string[];
}
