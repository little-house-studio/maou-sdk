/**
 * Subagent 多态策略 —— 四类 kind 的共享基类 + 差异点。
 *
 * 设计原则：
 *   - 表驱动默认（SUBAGENT_KIND_DEFAULTS）+ 策略对象差异，避免深继承树
 *   - 公共路径：resolve plan / materialize / pathGuard / run channel
 *   - 各 kind 只覆盖真正不同的行为
 *
 * 继承关系：
 *   BaseSubagentPolicy
 *     ├─ ForkSubagentPolicy   （完整上下文复制）
 *     ├─ HelperSubagentPolicy （单轮无 tool；非持久 → aux）
 *     ├─ TaskSubagentPolicy   （预设白名单 + loop）
 *     └─ ProjectSubagentPolicy（path 沙箱 + coding 白名单）
 */

import {
  type SubagentKind,
  type SubagentPermission,
  type TaskToolPresetName,
  type ForkKindPolicy,
  type ResolveForkKindInput,
  resolveForkKindPolicy,
  SUBAGENT_KIND_DEFAULTS,
} from "./subagent-kinds.js";
import { defineSubagent, type DefinedSubagent } from "./define-subagent.js";
import {
  materializeSubagent,
  type MaterializeResult,
} from "./subagent-lifecycle.js";

// ─── 运行通道 ──────────────────────────────────────────────────────────────

export type SubagentRunChannel = "executor" | "aux";

export interface PathGuardSpec {
  mode: "inherit" | "hard" | "audit";
  roots: string[];
  auditRoots?: string[];
}

export interface SubagentRunPlan extends ForkKindPolicy {
  runChannel: SubagentRunChannel;
  pathGuard?: PathGuardSpec;
  /** 是否应落盘目录模板 */
  shouldMaterialize: boolean;
}

// ─── 基类 ──────────────────────────────────────────────────────────────────

export abstract class BaseSubagentPolicy {
  abstract readonly kind: SubagentKind;

  /**
   * 解析运行计划（合并 kind 默认 + 调用方覆盖）。
   * 子类可 override 做额外校验（如 project 必须 path）。
   */
  resolve(input: Omit<ResolveForkKindInput, "kind"> = {}): SubagentRunPlan {
    const policy = resolveForkKindPolicy({ ...input, kind: this.kind });
    if (!policy) {
      throw new Error(`BaseSubagentPolicy: 无法解析 kind=${this.kind}`);
    }
    return this.enrich(policy, input);
  }

  /** 子类扩展：pathGuard / runChannel / materialize */
  protected enrich(
    policy: ForkKindPolicy,
    _input: Omit<ResolveForkKindInput, "kind">,
  ): SubagentRunPlan {
    return {
      ...policy,
      runChannel: policy.useExecutor ? "executor" : "aux",
      pathGuard: this.buildPathGuard(policy),
      shouldMaterialize: this.shouldMaterialize(policy),
    };
  }

  /** 是否物化目录（持久化且进管理列表） */
  shouldMaterialize(policy: ForkKindPolicy): boolean {
    return policy.persistContext === true && policy.listInManager === true;
  }

  /** 默认无 path 沙箱 */
  buildPathGuard(_policy: ForkKindPolicy): PathGuardSpec | undefined {
    return undefined;
  }

  /** 物化：define + materialize 一条龙 */
  materialize(
    opts: {
      maouRoot: string;
      name: string;
      parentAgentName?: string;
      systemPrompt?: string;
      path?: string;
      auditPaths?: string[];
      toolPreset?: TaskToolPresetName;
      permission?: SubagentPermission;
      tools?: string[] | null;
      persistContext?: boolean;
      enableLoop?: boolean;
      ephemeral?: boolean;
      force?: boolean;
    },
  ): { defined: DefinedSubagent; result: MaterializeResult } {
    const defined = defineSubagent({
      kind: this.kind,
      name: opts.name,
      parentAgentName: opts.parentAgentName,
      systemPrompt: opts.systemPrompt,
      path: opts.path,
      auditPaths: opts.auditPaths,
      toolPreset: opts.toolPreset,
      permission: opts.permission,
      tools: opts.tools,
      persistContext: opts.persistContext,
      enableLoop: opts.enableLoop,
      ephemeral: opts.ephemeral,
    });
    const result = materializeSubagent(defined, {
      maouRoot: opts.maouRoot,
      force: opts.force,
    });
    return { defined, result };
  }
}

// ─── 四类策略 ──────────────────────────────────────────────────────────────

export class ForkSubagentPolicy extends BaseSubagentPolicy {
  readonly kind = "fork" as const;

  protected enrich(
    policy: ForkKindPolicy,
    input: Omit<ResolveForkKindInput, "kind">,
  ): SubagentRunPlan {
    // fork：完整上下文；默认持久 nested
    const base = super.enrich(policy, input);
    return {
      ...base,
      inheritFullContext: policy.inheritFullContext ?? true,
      runChannel: "executor",
    };
  }
}

export class HelperSubagentPolicy extends BaseSubagentPolicy {
  readonly kind = "helper" as const;

  protected enrich(
    policy: ForkKindPolicy,
    input: Omit<ResolveForkKindInput, "kind">,
  ): SubagentRunPlan {
    const base = super.enrich(policy, input);
    // 非持久 → aux；持久 → executor 但仍 strip tools
    return {
      ...base,
      runChannel: policy.useExecutor ? "executor" : "aux",
      stripTools: true,
      tools: [],
      enableLoop: false,
    };
  }

  shouldMaterialize(policy: ForkKindPolicy): boolean {
    // helper 仅持久化才落盘进列表
    return policy.persistContext === true;
  }
}

export class TaskSubagentPolicy extends BaseSubagentPolicy {
  readonly kind = "task" as const;

  buildPathGuard(policy: ForkKindPolicy): PathGuardSpec | undefined {
    if (policy.path && policy.permission === "scoped_write") {
      return {
        mode: "hard",
        roots: [policy.path],
      };
    }
    return undefined;
  }
}

export class ProjectSubagentPolicy extends BaseSubagentPolicy {
  readonly kind = "project" as const;

  resolve(input: Omit<ResolveForkKindInput, "kind"> = {}): SubagentRunPlan {
    if (!input.path?.trim() && !SUBAGENT_KIND_DEFAULTS.project) {
      // path 在 define 时强校验；fork 时若缺 path 仍允许用 projectRoot 占位
    }
    return super.resolve(input);
  }

  buildPathGuard(policy: ForkKindPolicy): PathGuardSpec | undefined {
    if (!policy.path) return undefined;
    if (policy.permission === "project_unrestricted") {
      return {
        mode: "hard",
        roots: [policy.path, ...policy.auditPaths],
      };
    }
    // 默认 project_scoped_audit
    return {
      mode: "audit",
      roots: [policy.path],
      auditRoots: policy.auditPaths,
    };
  }

  shouldMaterialize(policy: ForkKindPolicy): boolean {
    // 子工程始终建议落盘（可回档的小型 coding agent）
    return policy.persistContext !== false;
  }
}

// ─── 注册表 / 工厂 ────────────────────────────────────────────────────────

export const SUBAGENT_POLICIES: Record<SubagentKind, BaseSubagentPolicy> = {
  fork: new ForkSubagentPolicy(),
  helper: new HelperSubagentPolicy(),
  task: new TaskSubagentPolicy(),
  project: new ProjectSubagentPolicy(),
};

export function getSubagentPolicy(kind: SubagentKind): BaseSubagentPolicy {
  const p = SUBAGENT_POLICIES[kind];
  if (!p) throw new Error(`未知 subagent kind: ${kind}`);
  return p;
}

/**
 * 统一入口：从 ForkOptions 风格输入得到完整 RunPlan。
 * 无 kind 时返回 null（兼容旧调用）。
 */
export function resolveSubagentRunPlan(
  input: ResolveForkKindInput,
): SubagentRunPlan | null {
  if (!input.kind) return null;
  const kind = input.kind as SubagentKind;
  if (!SUBAGENT_POLICIES[kind]) return null;
  return getSubagentPolicy(kind).resolve(input);
}

/**
 * 若 plan 需要物化则落盘；返回目录或 null。
 */
export function materializeIfNeeded(
  plan: SubagentRunPlan,
  opts: {
    maouRoot: string;
    name: string;
    parentAgentName?: string;
    systemPrompt?: string;
    force?: boolean;
  },
): MaterializeResult | null {
  if (!plan.shouldMaterialize) return null;
  const policy = getSubagentPolicy(plan.kind);
  const { result } = policy.materialize({
    maouRoot: opts.maouRoot,
    name: opts.name,
    parentAgentName: opts.parentAgentName,
    systemPrompt: opts.systemPrompt,
    path: plan.path,
    auditPaths: plan.auditPaths,
    permission: plan.permission,
    tools: plan.tools,
    persistContext: plan.persistContext,
    enableLoop: plan.enableLoop,
    ephemeral: plan.ephemeral,
    force: opts.force,
  });
  return result;
}
