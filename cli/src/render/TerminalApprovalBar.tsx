/**
 * TerminalApprovalBar —— normal 模式终端命令审批条（贴在输入 chrome 上方）。
 *
 * 不占用 overlay（不遮盖对话），用户能边看工具卡边选。
 * 快捷键：Y 允许一次 · A 始终允许 · N 拒绝 · B 黑名单 · Esc 拒绝
 * 鼠标：悬停高亮（与 NavBar 同套 hoverId + OSC8 手型）
 */

import React, { useRef, useEffect, useMemo } from "react";
import { Box, Text, Transform } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
import { handleEscapeCancel, isEscapeKey } from "../hooks/escape-cancel.js";
import { useClickTarget, invalidateClickTargetCache } from "../input/click-target.js";
import { makeClickableTransform } from "../input/osc8-link.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import {
  answerTerminalApproval,
  type TerminalApprovalChoice,
} from "../input/terminal-approval.js";

function truncateCmd(cmd: string, maxW: number): string {
  const t = cmd.replace(/\s+/g, " ").trim();
  if (stringWidth(t) <= maxW) return t;
  let out = "";
  let w = 0;
  for (const ch of t) {
    const cw = stringWidth(ch) || 1;
    if (w + cw > maxW - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

function ChoiceBtn({
  label,
  choice,
  accent,
}: {
  label: string;
  choice: TerminalApprovalChoice;
  accent?: boolean;
}) {
  const t = useTheme();
  const req = useStore((s) => s.terminalApproval);
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(ref, () => {
    if (req) answerTerminalApproval(req.id, choice);
  }, [req?.id, choice]);
  const hover = useStore((s) => s.hoverId) === cid;
  // 与 SelectList / Nav 一致：悬停酸绿底黑字
  const bg = hover ? t.accent : accent ? t.warn : t.userBg;
  const fg = hover || accent ? "#101010" : t.user;
  const linkTransform = useMemo(
    () => makeClickableTransform(`approval/${choice}`),
    [choice],
  );

  return (
    <Box ref={ref} marginRight={1}>
      <Transform transform={linkTransform}>
        <Text backgroundColor={bg} color={fg} bold>
          {` ${label} `}
        </Text>
      </Transform>
    </Box>
  );
}

export function TerminalApprovalBar() {
  const t = useTheme();
  const term = useTerminalSize();
  const req = useStore((s) => s.terminalApproval);

  useCleanInput((ch, key) => {
    const r = useStore.getState().terminalApproval;
    if (!r) return;
    // Esc → 统一取消栈（拒绝审批）
    if (isEscapeKey(ch, key)) {
      handleEscapeCancel();
      return;
    }
    const c = (ch || "").toLowerCase();
    if (c === "y" || key.return) answerTerminalApproval(r.id, "once");
    else if (c === "a") answerTerminalApproval(r.id, "always");
    else if (c === "n") answerTerminalApproval(r.id, "deny");
    else if (c === "b") answerTerminalApproval(r.id, "blacklist");
  });

  // 弹出时作废点击缓存 + 下一帧再作废，保证 yoga 就绪后能 hover/点
  useEffect(() => {
    if (!req) return;
    invalidateClickTargetCache();
    const t1 = setTimeout(() => invalidateClickTargetCache(), 40);
    const t2 = setTimeout(() => invalidateClickTargetCache(), 120);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [req?.id]);

  if (!req) return null;

  const maxCmd = Math.max(20, term.cols - 8);
  const cmdLine = truncateCmd(req.command, maxCmd);
  const firstToken = req.command.trim().split(/\s+/)[0] || "cmd";

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      width="100%"
      borderStyle="single"
      borderColor={t.warn}
      paddingX={1}
    >
      <Text color={t.warn} bold>
        {"🔐 终端命令需要你确认"}
        <Text color={t.dim}>{` · ${req.agentName}`}</Text>
      </Text>
      <Text color={t.fg}>
        <Text color={t.accent}>{"$ "}</Text>
        {cmdLine}
      </Text>
      {req.cwd ? (
        <Text color={t.dim}>{`cwd: ${req.cwd}`}</Text>
      ) : null}
      <Box flexDirection="row" marginTop={0}>
        <ChoiceBtn label="Y 允许一次" choice="once" accent />
        <ChoiceBtn label={`A 始终允许 ${firstToken}`} choice="always" />
        <ChoiceBtn label="N 拒绝" choice="deny" />
        <ChoiceBtn label="B 拉黑" choice="blacklist" />
      </Box>
      <Text color={t.dim}>{"Y/Enter 允许 · A 白名单 · N/Esc 拒绝 · B 黑名单"}</Text>
    </Box>
  );
}
