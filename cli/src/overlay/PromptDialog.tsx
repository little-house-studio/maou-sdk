/**
 * PromptDialog —— /prompt 调试预览「最终发给 AI」的请求材料。
 * 分段：system / workspace / skills bake / tool 区 / before_user / tool schemas / compression / assembled。
 * 不进入对话 messages / 不占用 LLM 上下文；Esc 关闭。
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
import { handleEscapeCancel, isEscapeKey } from "../hooks/escape-cancel.js";
import { previewCurrentRequestBundle } from "../lib/preview-system.js";
import { DEFAULT_AGENT_NAME, resolveAgentName } from "../config/defaults.js";

export function PromptDialog() {
  const t = useTheme();
  const term = useTerminalSize();
  const agentName = resolveAgentName(useStore((s) => s.agentName), DEFAULT_AGENT_NAME);
  const overlayScrollCmd = useStore((s) => s.overlayScrollCmd);

  const bundle = useMemo(
    () => previewCurrentRequestBundle(agentName),
    [agentName],
  );

  const sections = bundle.sections.length
    ? bundle.sections
    : [
        {
          id: "err",
          title: "错误",
          body: bundle.error ?? "预览失败",
          charCount: 0,
          lineCount: 1,
        },
      ];

  // 默认打开 assembled_system（最接近真实 system），否则目录
  const defaultIdx = Math.max(
    0,
    sections.findIndex((s) => s.id === "assembled_system"),
  );
  const [secIdx, setSecIdx] = useState(defaultIdx >= 0 ? defaultIdx : 0);
  const sec = sections[Math.min(secIdx, sections.length - 1)]!;

  const body = sec.body.length ? sec.body : " ";
  const lines = useMemo(() => body.split("\n"), [body]);

  const panelW = Math.max(40, term.cols - 4);
  const panelH = Math.max(12, term.rows - 8);
  const headerLines = 5;
  const footerLines = 2;
  const viewH = Math.max(4, panelH - headerLines - footerLines);
  const maxScroll = Math.max(0, lines.length - viewH);
  const [scroll, setScroll] = useState(0);

  useEffect(() => {
    setScroll(0);
  }, [agentName, secIdx, sec.charCount]);

  const clampScroll = (n: number) => Math.max(0, Math.min(maxScroll, n));
  const clampSec = (n: number) =>
    Math.max(0, Math.min(sections.length - 1, n));

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
    // 分段切换
    if (char === "[" || (key.leftArrow && !key.shift)) {
      setSecIdx((i) => clampSec(i - 1));
      return;
    }
    if (char === "]" || (key.rightArrow && !key.shift)) {
      setSecIdx((i) => clampSec(i + 1));
      return;
    }
    if (key.tab) {
      setSecIdx((i) => (i + 1) % sections.length);
      return;
    }
    // 数字 0–8 跳段
    if (char >= "0" && char <= "9") {
      const n = Number(char);
      if (n < sections.length) setSecIdx(n);
      return;
    }
    // 全文模式：c 显示 combined dump
    if (char === "c" || char === "C") {
      const ci = sections.findIndex((s) => s.id === "assembled_system");
      if (ci >= 0) setSecIdx(ci);
      return;
    }
    if (char === "a" || char === "A") {
      // combined as virtual — inject if not present by showing assembled
      const all = sections.findIndex((s) => s.id === "toc");
      if (all >= 0) setSecIdx(all);
      return;
    }
    if (key.upArrow) setScroll((s) => clampScroll(s - 1));
    else if (key.downArrow) setScroll((s) => clampScroll(s + 1));
    else if (key.pageUp) setScroll((s) => clampScroll(s - viewH));
    else if (key.pageDown) setScroll((s) => clampScroll(s + viewH));
    else if (key.home) setScroll(0);
    else if (key.end) setScroll(maxScroll);
  });

  useEffect(() => {
    if (overlayScrollCmd === null) return;
    if (useStore.getState().overlay !== "prompt") return;
    setScroll((s) =>
      clampScroll(s + (overlayScrollCmd.dir === "up" ? -3 : 3)),
    );
  }, [overlayScrollCmd, maxScroll, viewH]);

  const slice = lines.slice(scroll, scroll + viewH);
  while (slice.length < viewH) slice.push("");

  const meta = bundle.ok
    ? `${sec.charCount} 字 · ${sec.lineCount} 行 · skills ${bundle.skillCount} · tools ${bundle.toolCount}`
    : "编译失败";
  const pathHint = bundle.promptRoot
    ? `${bundle.promptRoot} / ${bundle.entrypoint}`
    : "";

  const scrollHint =
    maxScroll > 0
      ? `  ${scroll + 1}-${Math.min(scroll + viewH, lines.length)}/${lines.length}`
      : "";

  // 分段标签行
  const tabLabels = sections
    .map((s, i) => {
      const mark = i === secIdx ? "●" : "○";
      const short = s.id === "toc" ? "0目录" : s.title.replace(/^[\d\s·]+/, "").slice(0, 8);
      return `${mark}${i}:${short}`;
    })
    .join(" ");

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
        {`▸ Request Preview · ${agentName} · ${sec.title}`}
      </Text>
      <Text color={t.muted} wrap="truncate-end">
        {tabLabels}
      </Text>
      <Text color={t.muted}>
        {meta}
        {scrollHint}
      </Text>
      {pathHint ? (
        <Text color={t.dim} wrap="truncate-end">
          {pathHint}
          {sec.note ? ` · ${sec.note}` : ""}
        </Text>
      ) : (
        <Text color={t.dim}>{sec.note ?? " "}</Text>
      )}
      <Text color={t.borderMuted}>{"─".repeat(Math.max(8, panelW - 4))}</Text>

      <Box flexDirection="column" flexGrow={1} height={viewH}>
        {slice.map((line, i) => (
          <Text
            key={`${secIdx}-${scroll}-${i}`}
            color={bundle.ok ? t.fg : t.err}
            wrap="truncate-end"
          >
            {line.length === 0 ? " " : line}
          </Text>
        ))}
      </Box>

      <Text color={t.dim}>
        [ ]/←→/Tab 切换分段 · 0-8 跳转 · ↑↓/PgUp/Dn 滚动 · Esc/q 关闭（不进上下文）
      </Text>
    </Box>
  );
}
