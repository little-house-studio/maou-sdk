/**
 * EventBlock —— 输入框上方的流式事件块。
 * 显示当前轮：模式（思考中/生成中/工具待执行）+ 上传/下传 token。
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { compact, codename } from "../layout/decorators.js";

export function EventBlock() {
  const t = useTheme();
  const { eventBlock, streaming } = useStore();

  if (!streaming && eventBlock.mode === "idle") {
    return (
      <Box flexShrink={0} paddingX={1}>
        <Text color={t.dim}>{"─".repeat(30)}</Text>
      </Box>
    );
  }

  const modeLabel: Record<string, string> = {
    thinking: "思考中",
    generating: "生成中",
    tool_pending: `工具 ${eventBlock.detail ?? ""}`,
    error: "错误",
    idle: "待命",
  };
  const modeColor = eventBlock.mode === "error" ? t.err
    : eventBlock.mode === "tool_pending" ? t.warn
    : eventBlock.mode === "thinking" ? t.info
    : t.accent;

  return (
    <Box flexShrink={0} paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text color={modeColor} bold>{modeLabel[eventBlock.mode] ?? "处理中"}</Text>
        {eventBlock.detail && eventBlock.mode !== "tool_pending" && (
          <Text color={t.dim}>{eventBlock.detail}</Text>
        )}
      </Box>
      <Text color={t.dim}>{codename("tokens")} {compact(eventBlock.upTokens)}↑ {compact(eventBlock.downTokens)}↓</Text>
    </Box>
  );
}
