/**
 * GoalPanel —— goal 监督模式的可展开面板。
 *
 * supervisor active 时在对话区顶部（EventBlock 下方）显示：
 *   - 计划摘要 / 完整计划（可折叠）
 *   - 当前状态 + 验收轮数
 *   - 确认/修改/验收按钮（confirming_plan→确认计划，confirming→最终验收）
 *
 * 按钮通过 store.requestSend 发文本给 runtime（SDK supervisor 据文本调 start/end）。
 * 计划从 store.supervisor.plan 读（useSupervisorState 从 SDK 同步）。
 */
import React, { useState, useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useClickTarget } from "../input/click-target.js";

export function GoalPanel() {
  const t = useTheme();
  const supervisor = useStore((s) => s.supervisor);
  const [open, setOpen] = useState(true);

  if (!supervisor?.active) return null;

  const plan = supervisor.plan;
  const stateColor = supervisor.state === "confirming_plan" || supervisor.state === "confirming" ? t.warn : t.accent;
  const stateLabel: Record<string, string> = {
    planning: "规划中",
    confirming_plan: "待确认计划",
    started: `执行中 · ${supervisor.verifyRounds ?? 0} 轮`,
    confirming: "待最终验收",
    ended: "已结束",
  };

  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={stateColor} paddingX={1}>
      {/* 标题行 */}
      <Box justifyContent="space-between">
        <Text color={stateColor} bold>🎯 监督模式 · {stateLabel[supervisor.state] ?? supervisor.state}</Text>
        <Text color={t.dim}>{plan ? `${plan.length} 字计划 ${open ? "▼" : "▶"}` : ""}</Text>
      </Box>

      {/* 计划正文（限高 10 行，超出截断 + 提示） */}
      {open && plan && (
        <Box flexDirection="column">
          {plan.split("\n").slice(0, 10).map((line, i) => (
            <Text key={i} color={t.fg} wrap="wrap">{line || " "}</Text>
          ))}
          {plan.split("\n").length > 10 && (
            <Text color={t.dim}>…（共 {plan.split("\n").length} 行，展开 EventBlock 查看完整监督输出）</Text>
          )}
        </Box>
      )}

      {/* 操作按钮 */}
      {supervisor.state === "confirming_plan" && (
        <GoalButton bg={t.accent} fg="#000" label="✓ 确认计划，开始监督" onClick={() => useStore.getState().requestSend("确认")} />
      )}
      {supervisor.state === "confirming_plan" && (
        <GoalButton bg={t.muted} fg={t.fg} label="✎ 修改（聚焦输入框）" onClick={() => useStore.getState().setOverlay(null)} />
      )}
      {supervisor.state === "confirming" && (
        <GoalButton bg={t.ok} fg="#000" label="✓ 通过验收，结束监督" onClick={() => useStore.getState().requestSend("通过")} />
      )}
      {supervisor.state === "started" && supervisor.lastVerdict && (
        <Text color={supervisor.lastVerdict === "pass" ? t.ok : t.err}>
          上轮验收：{supervisor.lastVerdict === "pass" ? "合格" : "不合格"}
        </Text>
      )}
    </Box>
  );
}

function GoalButton({ bg, fg, label, onClick }: { bg: string; fg: string; label: string; onClick: () => void }) {
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, onClick, [label]);
  return (
    <Box ref={ref} backgroundColor={bg} justifyContent="center">
      <Text backgroundColor={bg} color={fg} bold>{` ${label} `}</Text>
    </Box>
  );
}
