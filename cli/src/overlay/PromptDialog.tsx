/**
 * PromptDialog —— /prompt 本地预览当前 agent 渲染后的 system 提示词。
 * 不进入对话 messages / 不占用 LLM 上下文；Esc 关闭。
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
import { handleEscapeCancel, isEscapeKey } from "../hooks/escape-cancel.js";
import { previewCurrentSystemPrompt } from "../lib/preview-system.js";
import { DEFAULT_AGENT_NAME, resolveAgentName } from "../config/defaults.js";

export function PromptDialog() {
  const t = useTheme();
  const term = useTerminalSize();
  const agentName = resolveAgentName(useStore((s) => s.agentName), DEFAULT_AGENT_NAME);
  const overlayScrollCmd = useStore((s) => s.overlayScrollCmd);

  const preview = useMemo(
    () => previewCurrentSystemPrompt(agentName),
    [agentName],
  );

  const body = preview.ok
    ? preview.text
    : `（编译失败）\n${preview.error ?? "unknown error"}`;
  const lines = useMemo(() => (body.length ? body.split("\n") : [""]), [body]);

  // 面板尺寸：尽量占满对话区
  const panelW = Math.max(40, term.cols - 4);
  const panelH = Math.max(12, term.rows - 8);
  const headerLines = 4; // title + meta + blank
  const footerLines = 1;
  const viewH = Math.max(4, panelH - headerLines - footerLines);
  const maxScroll = Math.max(0, lines.length - viewH);
  const [scroll, setScroll] = useState(0);

  // 内容刷新时回到顶部
  useEffect(() => {
    setScroll(0);
  }, [agentName, preview.charCount, preview.error]);

  const clampScroll = (n: number) => Math.max(0, Math.min(maxScroll, n));

  // 本地再绑一层 Esc/q 关闭，防止全局 handler 漏接时卡死在 /prompt
  useCleanInput((char, key) => {
    if (useStore.getState().overlay !== "prompt") return;
    if (isEscapeKey(char, key) || char === "q" || char === "Q") {
      if (char === "q" || char === "Q") {
        useStore.getState().setOverlay(null);
      } else {
        handleEscapeCancel();
      }
      return;
    }
    if (key.upArrow) setScroll((s) => clampScroll(s - 1));
    else if (key.downArrow) setScroll((s) => clampScroll(s + 1));
    else if (key.pageUp) setScroll((s) => clampScroll(s - viewH));
    else if (key.pageDown) setScroll((s) => clampScroll(s + viewH));
    else if (key.home) setScroll(0);
    else if (key.end) setScroll(maxScroll);
  });

  // 滚轮
  useEffect(() => {
    if (overlayScrollCmd === null) return;
    if (useStore.getState().overlay !== "prompt") return;
    setScroll((s) =>
      clampScroll(s + (overlayScrollCmd.dir === "up" ? -3 : 3)),
    );
  }, [overlayScrollCmd, maxScroll, viewH]);

  const slice = lines.slice(scroll, scroll + viewH);
  // 补空行填满视口，避免高度跳动
  while (slice.length < viewH) slice.push("");

  const meta = preview.ok
    ? `${preview.charCount} 字 · ${preview.lineCount} 行 · skills ${preview.skillCount}`
    : "编译失败";
  const pathHint = preview.promptRoot
    ? `${preview.promptRoot} / ${preview.entrypoint}`
    : "";

  const scrollHint =
    maxScroll > 0
      ? `  ${scroll + 1}-${Math.min(scroll + viewH, lines.length)}/${lines.length}`
      : "";

  return (
    <Box
      position="absolute"
      top={1}
      left={1}
      width={panelW}
      height={panelH}
      flexDirection="column"
      borderStyle="round"
      borderColor={t.accent}
      backgroundColor={t.panelBg}
      paddingX={1}
    >
      <Text color={t.accent} bold>
        {`▸ System Prompt · ${agentName}`}
      </Text>
      <Text color={t.muted}>{meta}{scrollHint}</Text>
      {pathHint ? (
        <Text color={t.dim} wrap="truncate-end">
          {pathHint}
        </Text>
      ) : (
        <Text color={t.dim}> </Text>
      )}
      <Text color={t.borderMuted}>{"─".repeat(Math.max(8, panelW - 4))}</Text>

      <Box flexDirection="column" flexGrow={1} height={viewH}>
        {slice.map((line, i) => (
          <Text
            key={`${scroll}-${i}`}
            color={preview.ok ? t.fg : t.err}
            wrap="truncate-end"
          >
            {line.length === 0 ? " " : line}
          </Text>
        ))}
      </Box>

      <Text color={t.dim}>
        ↑↓/滚轮 滚动 · PgUp/PgDn · Esc/q 返回（不进上下文）
      </Text>
    </Box>
  );
}
