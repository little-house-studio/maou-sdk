/**
 * CLI ToolCard UI — title chip + fold + input/output sections.
 * Logic port of cli/tui-ratatui render_tool_card / tool_title_line.
 */
import React, { useEffect, useState } from "react";
import type { DraftMessage } from "../types";
import {
  isDiffResult,
  isWriteTool,
  resolveToolCard,
  slicePreview,
  toolFoldMark,
  toolTitleMeta,
} from "../tool-card";

export type ToolCardProps = {
  message: DraftMessage;
  /** When false, still show fold chevron (CLI always clickable on title). */
  defaultExpanded?: boolean;
  /** 终端会话 id（有则显示「打开终端」，不自动弹） */
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
  // Running / error cards open by default so the user sees progress or failure
  const [expanded, setExpanded] = useState(
    () => defaultExpanded || !card.done || card.isError,
  );
  const [resultFull, setResultFull] = useState(false);
  const [spinFrame, setSpinFrame] = useState(0);
  const meta = toolTitleMeta(card);
  const mark = toolFoldMark(card, expanded, spinFrame);
  const nameCls = card.isError
    ? "wire-tool-name is-error"
    : "wire-tool-name";

  // Animate CLI spinner while tool is still running
  useEffect(() => {
    if (card.done) return;
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      setSpinFrame((f) => f + 1);
    }, 80);
    return () => window.clearInterval(id);
  }, [card.done]);

  // If a card flips to error after mount, expand so the failure is visible
  useEffect(() => {
    if (card.isError) setExpanded(true);
  }, [card.isError]);

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
      <div className="wire-tool-title-row">
        <button
          type="button"
          className="wire-tool-title"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? "收起工具卡" : "展开工具卡"}
        >
          <span className={nameCls}>{card.name}</span>
          {meta ? <span className="wire-tool-meta">{meta}</span> : null}
          <span className="wire-tool-mark" aria-hidden>
            {mark}
          </span>
        </button>
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
      </div>

      {expanded ? (
        <div className="wire-tool-body">
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
      ) : null}
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
