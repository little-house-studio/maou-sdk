/**
 * CLI ToolCard UI — title chip + fold + input/output sections.
 * Logic port of cli/tui-ratatui render_tool_card / tool_title_line.
 */
import React, { useEffect, useState } from "react";
import { Fold } from "../../motion";
import type { DraftMessage } from "../types";
import { durationStr } from "./message-meta";
import {
  isDiffResult,
  isWriteTool,
  resolveToolCard,
  slicePreview,
  toolCardInitiallyExpanded,
  toolDurationLabel,
  toolFoldMark,
  toolIntentLabel,
} from "./tool-card";

export type ToolCardProps = {
  message: DraftMessage;
  /** 标题行初始展开（默认折叠） */
  defaultExpanded?: boolean;
  /** 终端会话 id（展开后可点「打开终端」） */
  terminalId?: string;
  onOpenTerminal?: () => void;
};

export function ToolCard({
  message,
  defaultExpanded = false,
  terminalId,
  onOpenTerminal,
}: ToolCardProps) {
  const card = resolveToolCard(message);
  const [expanded, setExpanded] = useState(() =>
    toolCardInitiallyExpanded(defaultExpanded),
  );
  const [resultFull, setResultFull] = useState(false);
  const running = card.done !== true;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [running]);
  const intent = toolIntentLabel(card);
  const startedAt = message.meta?.ts;
  const dur = running
    ? durationStr(
        card.durationMs ??
          (startedAt != null ? Math.max(0, now - startedAt) : undefined),
      ) || (startedAt != null ? "0ms" : "")
    : toolDurationLabel(card);
  const mark = toolFoldMark(card, expanded);
  const led = card.isError ? "err" : card.done ? "ok" : "wait";

  const argsPreview = card.args
    ? slicePreview(prettyArgs(card.args), card.name, true)
    : null;
  const resultSlice = card.result
    ? slicePreview(card.result, card.name, resultFull)
    : null;

  return (
    <div
      className={`wire-tool-card${card.isError ? " is-error" : ""}${
        card.done ? " is-done" : " is-running"
      }${expanded ? " is-expanded" : " is-collapsed"}`}
      data-tool-name={card.name}
      data-tool-done={card.done ? "true" : "false"}
      aria-busy={card.done ? undefined : "true"}
    >
      <button
        type="button"
        className="wire-tool-title"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? "收起工具卡" : "展开工具卡"}
      >
        <span
          className={`wire-tool-led is-${led}`}
          data-tool-led={led}
          aria-hidden
        />
        <span className="wire-tool-name">{card.name}</span>
        {intent ? <span className="wire-tool-intent">{intent}</span> : null}
        {dur ? <span className="wire-tool-dur">{dur}</span> : null}
        <span className="wire-tool-grow" aria-hidden />
        <span className="wire-tool-mark" aria-hidden>
          {mark}
        </span>
      </button>

      <Fold open={expanded}>
        <div className="wire-tool-body">
          {terminalId && onOpenTerminal ? (
            <button
              type="button"
              className="wire-tool-open-term"
              onClick={(e) => {
                e.stopPropagation();
                onOpenTerminal();
              }}
              title={`打开终端 ${terminalId}`}
            >
              打开终端
            </button>
          ) : null}
          {argsPreview &&
          argsPreview.show &&
          argsPreview.show !== "{}" &&
          argsPreview.show !== "{\n}" ? (
            <div className="wire-tool-section">
              <div className="wire-tool-section-label">▸ 输入</div>
              <pre className="wire-tool-pre is-input">{argsPreview.show}</pre>
            </div>
          ) : null}

          {resultSlice && resultSlice.show ? (
            <div className="wire-tool-section">
              <div className="wire-tool-section-label">
                {card.isError ? "▸ 输出（失败）" : "▸ 输出"}
              </div>
              {isDiffResult(card.result) || isWriteTool(card.name) ? (
                <pre className="wire-tool-pre is-output is-diff">
                  {resultSlice.show.split("\n").map((line, i) => (
                    <span
                      key={i}
                      className={
                        line.startsWith("+") && !line.startsWith("+++")
                          ? "diff-add"
                          : line.startsWith("-") && !line.startsWith("---")
                            ? "diff-del"
                            : "diff-ctx"
                      }
                    >
                      {line}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              ) : (
                <pre
                  className={`wire-tool-pre is-output${
                    card.isError ? " is-error" : ""
                  }`}
                >
                  {resultSlice.show}
                </pre>
              )}
              {resultSlice.needFold ? (
                <button
                  type="button"
                  className="wire-tool-fold"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResultFull((v) => !v);
                  }}
                >
                  {resultFull
                    ? "▲ 收起输出"
                    : isDiffResult(card.result) || isWriteTool(card.name)
                      ? `▼ 展开完整 diff（${resultSlice.totalLines} 行 · 点击展开）`
                      : `▼ 展开完整输出（${resultSlice.totalLines} 行 · 点击）`}
                </button>
              ) : null}
            </div>
          ) : null}

          {!argsPreview?.show && !resultSlice?.show ? (
            <div className="wire-tool-section">
              <pre className="wire-tool-pre is-output">{message.body}</pre>
            </div>
          ) : null}
        </div>
      </Fold>
    </div>
  );
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}
