/**
 * defineEval — Agent 评估系统 API（对标 Vercel Eve）
 *
 * 用法：在 evals/ 目录下创建 .eval.ts 文件，导出 defineEval() 的返回值。
 * 文件名即评估名（如 revenue.eval.ts → 评估名 "revenue"）。
 *
 * @example
 * // evals/revenue.eval.ts
 * import { defineEval, includes } from "@little-house-studio/agent/eval";
 *
 * export default defineEval({
 *   description: "测试 Agent 是否按团队规则回答收入问题",
 *   async test(t) {
 *     await t.send("上周收入是多少？");
 *     t.completed();
 *     t.calledTool("run_sql");
 *     t.check(t.reply, includes("净退款"));
 *   },
 * });
 */

// ─── 断言工具 ──────────────────────────────────────────────────────────────

export type EvalCheckResult = { pass: boolean; message: string };

/**
 * includes — 检查回复是否包含指定文本
 */
export function includes(text: string): (actual: string) => EvalCheckResult {
  return (actual: string) => {
    const pass = actual.includes(text);
    return {
      pass,
      message: pass
        ? `✓ 回复包含「${text}」`
        : `✗ 回复不包含「${text}」`,
    };
  };
}

/**
 * notIncludes — 检查回复不包含指定文本
 */
export function notIncludes(text: string): (actual: string) => EvalCheckResult {
  return (actual: string) => {
    const pass = !actual.includes(text);
    return {
      pass,
      message: pass
        ? `✓ 回复不包含「${text}」`
        : `✗ 回复不应包含「${text}」`,
    };
  };
}

/**
 * matchesRegex — 正则匹配
 */
export function matchesRegex(pattern: RegExp, description?: string): (actual: string) => EvalCheckResult {
  return (actual: string) => {
    const pass = pattern.test(actual);
    return {
      pass,
      message: pass
        ? `✓ 匹配正则${description ? `「${description}」` : ""}`
        : `✗ 不匹配正则${description ? `「${description}」` : `/${pattern.source}/`}`,
    };
  };
}

/**
 * equals — 严格相等
 */
export function equals(expected: string): (actual: string) => EvalCheckResult {
  return (actual: string) => {
    const pass = actual === expected;
    return {
      pass,
      message: pass
        ? `✓ 等于预期值`
        : `✗ 不等于预期值（实际: "${actual.slice(0, 50)}"）`,
    };
  };
}

// ─── EvalContext ────────────────────────────────────────────────────────────

/**
 * 评估上下文 — 在 test() 函数中使用
 */
export class EvalContext {
  /** 最后一条 Agent 回复 */
  reply: string = "";

  /** 被调用的工具列表 */
  private _calledTools: string[] = [];

  /** 检查结果列表 */
  private _checks: EvalCheckResult[] = [];

  /** 是否已完成 */
  private _completed = false;

  /** 发送的消息列表 */
  private _sentMessages: string[] = [];

  /**
   * 发送消息给 Agent（在 eval runner 中实现）
   */
  send: (message: string) => Promise<string> = async (_message: string) => {
    throw new Error("EvalContext.send() 需要在 runner 中注入");
  };

  /**
   * 标记测试完成
   */
  completed(): void {
    this._completed = true;
  }

  /**
   * 记录被调用的工具
   */
  calledTool(name: string): void {
    this._calledTools.push(name);
  }

  /**
   * 执行断言检查
   */
  check(actual: string, assertion: (actual: string) => EvalCheckResult): void {
    const result = assertion(actual);
    this._checks.push(result);
  }

  /** 获取检查结果 */
  get checks(): EvalCheckResult[] {
    return this._checks;
  }

  /** 获取被调用的工具 */
  get calledTools(): string[] {
    return this._calledTools;
  }

  /** 是否已完成 */
  get isCompleted(): boolean {
    return this._completed;
  }

  /** 获取发送的消息 */
  get sentMessages(): string[] {
    return this._sentMessages;
  }
}

// ─── defineEval ─────────────────────────────────────────────────────────────

export interface DefineEvalConfig {
  /** 评估描述 */
  description: string;

  /** 测试函数 */
  test: (t: EvalContext) => Promise<void> | void;
}

export interface DefinedEval {
  readonly _type: "defineEval";
  readonly _source: "file";

  /** 评估名（文件名去掉扩展名） */
  name: string;

  /** 描述 */
  description: string;

  /** 测试函数 */
  test: (t: EvalContext) => Promise<void> | void;
}

/**
 * 定义一个 Agent 评估
 */
export function defineEval(config: DefineEvalConfig): (name: string) => DefinedEval {
  return (name: string) => ({
    _type: "defineEval",
    _source: "file",
    name,
    description: config.description,
    test: config.test,
  });
}

// ─── EvalRunner ─────────────────────────────────────────────────────────────

export interface EvalRunResult {
  evalName: string;
  description: string;
  passed: boolean;
  checks: EvalCheckResult[];
  error?: string;
  duration: number;
}

/**
 * 评估运行器
 */
export class EvalRunner {
  private _sendFn: (message: string) => Promise<string>;

  constructor(sendFn: (message: string) => Promise<string>) {
    this._sendFn = sendFn;
  }

  /**
   * 运行单个评估
   */
  async run(evalDef: DefinedEval): Promise<EvalRunResult> {
    const startTime = Date.now();
    const ctx = new EvalContext();

    // 注入 send 实现
    ctx.send = async (message: string) => {
      const reply = await this._sendFn(message);
      ctx.reply = reply;
      return reply;
    };

    try {
      await evalDef.test(ctx);

      const allPassed = ctx.checks.every((c) => c.pass);
      return {
        evalName: evalDef.name,
        description: evalDef.description,
        passed: allPassed && ctx.isCompleted,
        checks: ctx.checks,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        evalName: evalDef.name,
        description: evalDef.description,
        passed: false,
        checks: ctx.checks,
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 运行多个评估
   */
  async runAll(evals: DefinedEval[]): Promise<EvalRunResult[]> {
    const results: EvalRunResult[] = [];
    for (const evalDef of evals) {
      results.push(await this.run(evalDef));
    }
    return results;
  }

  /**
   * 格式化评估结果
   */
  static formatResults(results: EvalRunResult[]): string {
    const lines: string[] = [];
    let totalPassed = 0;
    let totalFailed = 0;

    for (const result of results) {
      const icon = result.passed ? "✅" : "❌";
      lines.push(`${icon} ${result.evalName} (${result.duration}ms)`);
      lines.push(`   ${result.description}`);

      for (const check of result.checks) {
        lines.push(`   ${check.message}`);
      }

      if (result.error) {
        lines.push(`   ⚠ Error: ${result.error}`);
      }

      if (result.passed) totalPassed++;
      else totalFailed++;
      lines.push("");
    }

    lines.push(`─── 总计: ${totalPassed} 通过, ${totalFailed} 失败 ───`);
    return lines.join("\n");
  }
}
