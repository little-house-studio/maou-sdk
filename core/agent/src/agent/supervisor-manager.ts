/**
 * SupervisorManager —— 管理 /goal 模式下的「主 Agent ↔ 监督 Agent」绑定。
 *
 * 职责：
 *   - 维护 mainSessionId ↔ supervisorSessionId 双向映射
 *   - 记录监督状态（plan / started / confirming / ended）
 *   - 提供 isSupervisorSession / isSupervisorMode 查询
 *
 * 全局单例，进程内状态（不持久化 —— 监督模式重启后失效）。
 */

/** 监督状态 */
export type SupervisorState =
  | "planning" // supervisor 还在写 plan
  | "confirming_plan" // plan 已提交，等用户确认
  | "started" // 监督进行中（主 Agent 持续干活，每轮 loop 推送给 supervisor 验收）
  | "confirming" // supervisor 判定合格，向用户发起最终验收
  | "ended"; // 监督结束

/** 监督绑定记录 */
export interface SupervisorBinding {
  /** 主 Agent session ID（用户原始 session） */
  mainSessionId: string;
  /** 监督 Agent session ID（fork 出的临时 session） */
  supervisorSessionId: string;
  /** 监督 Agent 名（用于 MessageBus 寻址：主 Agent 推送给 supervisor） */
  supervisorAgentName?: string;
  /** 主 Agent 名（用于 MessageBus 寻址：supervisor 派需求给主 Agent） */
  mainAgentName?: string;
  /** 当前状态 */
  state: SupervisorState;
  /** 任务计划 MD（用户确认后写入） */
  plan?: string;
  /** 创建时间戳 */
  createdAt: number;
  /** chat key（飞书层用，便于路由层查询） */
  chatKey?: string;
  // ── 防死循环（步骤4）──
  /** 自动验收已进行的轮数 */
  verifyRounds: number;
  /** 最近一次验收 fail 的原因（用于检测同因循环） */
  lastFailReason?: string;
  /** 同一 fail 原因连续命中次数 */
  sameReasonStreak: number;
  // ── 去重（避免 chat_main 返回值与 loop_report 推送导致同一轮重复 verify）──
  /** 最近一次验收的 round_report 内容指纹（前 200 字符），相同则视为重复验收 */
  lastVerifiedReportFingerprint?: string;
  /** 最近一次验收的结论（pass/fail/loop），供重复验收时复用 */
  lastVerdict?: "pass" | "fail" | "loop";
}

class SupervisorManagerImpl {
  private mainToSupervisor = new Map<string, SupervisorBinding>();
  private supervisorToMain = new Map<string, SupervisorBinding>();
  private chatToBinding = new Map<string, SupervisorBinding>();

  /** 绑定主 Agent 和监督 Agent */
  bind(binding: Omit<SupervisorBinding, "createdAt" | "state" | "verifyRounds" | "sameReasonStreak"> & { state?: SupervisorState }): SupervisorBinding {
    const full: SupervisorBinding = {
      ...binding,
      state: binding.state ?? "planning",
      createdAt: Date.now(),
      verifyRounds: 0,
      sameReasonStreak: 0,
    };
    this.mainToSupervisor.set(binding.mainSessionId, full);
    this.supervisorToMain.set(binding.supervisorSessionId, full);
    if (binding.chatKey) {
      this.chatToBinding.set(binding.chatKey, full);
    }
    return full;
  }

  /** 解除绑定（监督结束时调用） */
  unbind(mainSessionId: string): SupervisorBinding | undefined {
    const binding = this.mainToSupervisor.get(mainSessionId);
    if (!binding) return undefined;
    this.mainToSupervisor.delete(binding.mainSessionId);
    this.supervisorToMain.delete(binding.supervisorSessionId);
    if (binding.chatKey) this.chatToBinding.delete(binding.chatKey);
    return binding;
  }

  /** 通过主 session ID 查监督绑定 */
  getByMain(mainSessionId: string): SupervisorBinding | undefined {
    return this.mainToSupervisor.get(mainSessionId);
  }

  /** 通过监督 session ID 查监督绑定 */
  getBySupervisor(supervisorSessionId: string): SupervisorBinding | undefined {
    return this.supervisorToMain.get(supervisorSessionId);
  }

  /** 通过 chat key 查监督绑定（飞书层路由用） */
  getByChat(chatKey: string): SupervisorBinding | undefined {
    return this.chatToBinding.get(chatKey);
  }

  /** 更新状态 */
  updateState(mainSessionId: string, state: SupervisorState): SupervisorBinding | undefined {
    const binding = this.mainToSupervisor.get(mainSessionId);
    if (!binding) return undefined;
    binding.state = state;
    return binding;
  }

  /** 更新计划 */
  updatePlan(mainSessionId: string, plan: string): SupervisorBinding | undefined {
    const binding = this.mainToSupervisor.get(mainSessionId);
    if (!binding) return undefined;
    binding.plan = plan;
    return binding;
  }

  /** 判断 session 是否是监督 Agent session */
  isSupervisorSession(sessionId: string): boolean {
    return this.supervisorToMain.has(sessionId);
  }

  /** 判断主 session 是否处于监督模式 */
  isSupervisorMode(mainSessionId: string): boolean {
    return this.mainToSupervisor.has(mainSessionId);
  }

  /** 列出所有活跃绑定（调试用） */
  list(): SupervisorBinding[] {
    return Array.from(this.mainToSupervisor.values());
  }

  /** 清空所有绑定（测试用） */
  clear(): void {
    this.mainToSupervisor.clear();
    this.supervisorToMain.clear();
    this.chatToBinding.clear();
  }
}

/** 全局单例 */
export const SUPERVISOR_MANAGER = new SupervisorManagerImpl();
