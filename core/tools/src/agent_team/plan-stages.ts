/**
 * /goal plan 阶段解析 —— 兼容纯 MD，可选结构化 stages。
 *
 * 支持：
 *  1) plan 正文中的 ```json:plan ... ``` 或 ```json ... ``` 含 stages
 *  2) YAML-like 简易列表（可选，优先 JSON）
 *
 * 结构示例：
 * ```json:plan
 * {
 *   "stages": [
 *     { "id": "s1", "title": "小样本", "check_command": "node scripts/check-s1.mjs" },
 *     { "id": "s2", "title": "大样本", "check_command": "node scripts/check-s2.mjs" }
 *   ]
 * }
 * ```
 */

export interface PlanStage {
  id: string;
  title?: string;
  /** 成功标准（给人/LLM 看） */
  success?: string;
  /** 硬指标命令（安全子集，见 hard-check） */
  check_command?: string;
}

export interface ParsedPlanMeta {
  stages: PlanStage[];
  /** 去掉 json 块后的 plan 正文（仍可用于 LLM） */
  planBody: string;
}

/**
 * What: parse_plan_stages
 * How: json_fenced_block
 */
export function parsePlanStages(plan: string): ParsedPlanMeta {
  const text = plan ?? "";
  const stages: PlanStage[] = [];
  let planBody = text;

  // ```json:plan ... ``` 或 ```json ... ```
  const fenceRe =
    /```(?:json:plan|plan-json|json)\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  const blocks: string[] = [];
  while ((m = fenceRe.exec(text)) !== null) {
    blocks.push(m[1] ?? "");
  }

  for (const block of blocks) {
    try {
      const obj = JSON.parse(block) as {
        stages?: unknown;
        check_command?: string;
      };
      if (Array.isArray(obj.stages)) {
        for (const raw of obj.stages) {
          if (!raw || typeof raw !== "object") continue;
          const s = raw as Record<string, unknown>;
          const id = String(s.id ?? s.name ?? "").trim();
          if (!id) continue;
          stages.push({
            id,
            title: s.title != null ? String(s.title) : undefined,
            success: s.success != null ? String(s.success) : s.criteria != null ? String(s.criteria) : undefined,
            check_command:
              s.check_command != null
                ? String(s.check_command)
                : s.checkCommand != null
                  ? String(s.checkCommand)
                  : undefined,
          });
        }
      }
    } catch {
      /* 非 JSON 块跳过 */
    }
  }

  // 从正文移除已解析的 fence，避免重复展示大段 JSON
  if (blocks.length > 0) {
    planBody = text.replace(fenceRe, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  return { stages, planBody: planBody || text };
}

/** 当前阶段说明（注入 verify 提示） */
export function formatStageStatus(opts: {
  stages: PlanStage[];
  currentStageIndex: number;
  stageResults?: Array<{ id: string; pass: boolean }>;
}): string {
  const { stages, currentStageIndex, stageResults } = opts;
  if (!stages.length) return "";
  const lines = ["## 分阶段进度"];
  stages.forEach((s, i) => {
    const res = stageResults?.find((r) => r.id === s.id);
    let mark = "⏳";
    if (res?.pass) mark = "✅";
    else if (res && !res.pass) mark = "❌";
    else if (i === currentStageIndex) mark = "▶️";
    else if (i < currentStageIndex) mark = "✅";
    lines.push(
      `${mark} [${i + 1}/${stages.length}] ${s.id}${s.title ? ` — ${s.title}` : ""}` +
        (s.check_command ? ` (check: \`${s.check_command}\`)` : "") +
        (s.success ? `\n   标准: ${s.success}` : ""),
    );
  });
  const cur = stages[currentStageIndex];
  if (cur) {
    lines.push("");
    lines.push(`当前阶段: **${cur.id}**（必须先通过本阶段才能进入下一阶段）`);
  }
  return lines.join("\n");
}
