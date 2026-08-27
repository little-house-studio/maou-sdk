import React, { useEffect, useRef, useState } from "react";
import { ChromeMark } from "../drafts/icons/Marks";
import { CommandLauncher } from "./CommandLauncher";
import { OptionalOutlet } from "./OptionalOutlet";
import { SlashMenu } from "./SlashMenu";
import {
  ApprovalSeat,
  LeftToolsFallback,
  ModelSeat,
  UsageSeat,
} from "./ComposerTools";
import { mentionQuery, slashPrefixAtCursor } from "./commands";
import { imageDataUrl } from "./images";
import { fitComposerHeight } from "./fit-height";
import type { ComposerProps } from "./types";

export function ComposerBar(props: ComposerProps) {
  const [draft, setDraft] = useState(props.input);
  const [cursor, setCursor] = useState(() => props.input.length);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const draftRef = useRef(props.input);
  const sentRef = useRef(props.input);
  const flushRaf = useRef(0);
  const tokenLive =
    !props.commandBlock && slashPrefixAtCursor(draft, cursor) != null;
  const liveSlash = tokenLive && !menuDismissed;
  const canSend =
    Boolean(props.commandBlock) ||
    Boolean(draft.trim()) ||
    Boolean(props.images?.length);
  const showStop = props.busy && !props.pendingApproval && !canSend;
  const sendMode = props.sendMode;
  const sendModeLabel = sendMode === "insert" ? "插入" : "队列";
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayOpen = Boolean(
    liveSlash || props.paletteOpen || props.mentionOpen,
  );

  const cancelFlush = () => {
    if (!flushRaf.current) return;
    cancelAnimationFrame(flushRaf.current);
    flushRaf.current = 0;
  };

  const flushParent = (value: string, at: number) => {
    const slash = slashPrefixAtCursor(value, at) != null;
    const needsParent =
      Boolean(props.paletteOpen) ||
      slash ||
      mentionQuery(value) != null ||
      props.slashOpen ||
      props.mentionOpen;
    if (!needsParent) return;
    cancelFlush();
    flushRaf.current = requestAnimationFrame(() => {
      flushRaf.current = 0;
      sentRef.current = value;
      props.onInputChange(value);
    });
  };

  useEffect(() => () => cancelFlush(), []);

  const syncKey = props.inputEpoch ?? props.input;
  useEffect(() => {
    if (props.input === draftRef.current) return;
    draftRef.current = props.input;
    sentRef.current = props.input;
    setDraft(props.input);
    setCursor(props.input.length);
    setMenuDismissed(false);
  }, [syncKey, props.input]);

  useEffect(() => {
    const el = props.inputRef.current;
    if (el) fitComposerHeight(el);
  }, [draft, props.inputRef]);

  useEffect(() => {
    if (!overlayOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
    const overlay = document.querySelector("[data-composer-overlay]");
    const launch = wrapRef.current?.querySelector("[data-composer-launch]");
      if (overlay?.contains(t) || launch?.contains(t)) return;
      setMenuDismissed(true);
      props.onOverlayDismiss?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setMenuDismissed(true);
      props.onOverlayDismiss?.();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, props.onOverlayDismiss]);

  return (
    <div className="composer codex-composer wire-composer" data-composer-bar="">
      <div className="composer-row-wrap" ref={wrapRef}>
        <OptionalOutlet
          name="composer.overlay"
          props={props}
          fallback={<SlashMenu {...props} />}
        />
        <div
          data-composer-card=""
          className={`composer-row wire-composer-card composer-card${
            props.pendingApproval ? " has-pending-approval" : ""
          }${props.busy ? " is-busy" : ""}${
            sendMode === "insert" ? " mode-insert" : " mode-queue"
          }`}
        >
          {props.images?.length ? (
            <div className="composer-attach-row" data-composer-images="">
              {props.images.map((img, i) => (
                <button
                  key={`${img.mimeType}-${i}`}
                  type="button"
                  className="composer-attach-chip"
                  title="移除此图"
                  onClick={() =>
                    props.onImagesChange?.(
                      (props.images ?? []).filter((_, j) => j !== i),
                    )
                  }
                >
                  <img src={imageDataUrl(img)} alt="" />
                  <span>{img.name || `图${i + 1}`}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="composer-input-row">
            {props.commandBlock ? (
              <button
                type="button"
                className={`composer-cmd-block${
                  props.commandBlockSelected ? " is-selected" : ""
                }`}
                aria-label={`指令 /${props.commandBlock}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  props.onCommandBlockSelect?.(true);
                  props.inputRef.current?.focus();
                }}
              >
                /{props.commandBlock}
              </button>
            ) : null}
            <textarea
              ref={props.inputRef}
              className="wire-composer-input composer-input"
              value={draft}
              rows={2}
              placeholder={
                props.commandBlock ? "参数或消息…" : props.placeholder
              }
              onChange={(e) => {
                const v = e.target.value;
                const at = e.target.selectionStart ?? 0;
                draftRef.current = v;
                setDraft(v);
                setCursor(at);
                setMenuDismissed(false);
                props.onCommandBlockSelect?.(false);
                props.onCursorChange?.(at);
                fitComposerHeight(e.target);
                flushParent(v, at);
              }}
              onClick={(e) => {
                const at = e.currentTarget.selectionStart ?? 0;
                setCursor(at);
                props.onCommandBlockSelect?.(false);
                props.onCursorChange?.(at);
                flushParent(draftRef.current, at);
              }}
              onSelect={(e) => {
                const at = e.currentTarget.selectionStart ?? 0;
                setCursor(at);
                props.onCursorChange?.(at);
                flushParent(draftRef.current, at);
              }}
              onKeyUp={(e) => {
                const at = e.currentTarget.selectionStart ?? 0;
                setCursor(at);
                props.onCursorChange?.(at);
                flushParent(draftRef.current, at);
              }}
              onPaste={props.onInputPaste}
              onBlur={props.onInputBlur}
              onKeyDown={(e) => {
                const start = e.currentTarget.selectionStart ?? 0;
                const end = e.currentTarget.selectionEnd ?? 0;
                setCursor(start);
                props.onCursorChange?.(start);
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.altKey &&
                  !e.nativeEvent.isComposing
                ) {
                  cancelFlush();
                }
                if (props.commandBlock) {
                  const edge =
                    start === 0 &&
                    end === 0 &&
                    (e.key === "Backspace" ||
                      (e.key === "ArrowLeft" && !e.altKey && !e.metaKey));
                  if (
                    (e.key === "Backspace" || e.key === "Delete") &&
                    (props.commandBlockSelected ||
                      (start === 0 && end === 0 && e.key === "Backspace"))
                  ) {
                    e.preventDefault();
                    props.onCommandBlockChange?.(null);
                    props.onCommandBlockSelect?.(false);
                    return;
                  }
                  if (edge && e.key === "ArrowLeft") {
                    e.preventDefault();
                    props.onCommandBlockSelect?.(true);
                    return;
                  }
                  if (
                    props.commandBlockSelected &&
                    (e.key === "ArrowRight" || e.key === "Escape")
                  ) {
                    e.preventDefault();
                    props.onCommandBlockSelect?.(false);
                    return;
                  }
                }
                props.onInputKeyDown(e);
              }}
            />
          </div>
          <div className="composer-toolbar wire-composer-toolbar">
            <div className="composer-toolbar-left wire-composer-tools">
              <CommandLauncher
                {...props}
                input={draft}
                slashOpen={liveSlash}
              />
              <div className="composer-modes">
                <OptionalOutlet
                  name="composer.approval-mode"
                  props={props}
                  fallback={<ApprovalSeat {...props} />}
                />
              </div>
              <OptionalOutlet
                name="composer.left"
                props={props}
                fallback={<LeftToolsFallback {...props} />}
              />
            </div>
            <div className="composer-toolbar-right wire-composer-actions">
              {props.statusDisplay ? (
                <span
                  className={`composer-status${props.statusError ? " is-error" : ""}${
                    props.pendingApproval ? " is-approval" : ""
                  }${props.busy && !props.statusError ? " is-busy" : ""}`}
                  title={props.statusTitle || props.statusDisplay}
                >
                  {props.busy && !props.statusError ? (
                    <span className="composer-status-dot" aria-hidden />
                  ) : null}
                  <span className="composer-status-text">{props.statusDisplay}</span>
                </span>
              ) : null}
              <OptionalOutlet
                name="composer.right"
                props={props}
                fallback={null}
              />
              <OptionalOutlet
                name="composer.model"
                props={props}
                fallback={<ModelSeat {...props} />}
              />
              <OptionalOutlet
                name="composer.usage"
                props={props}
                fallback={<UsageSeat {...props} />}
              />
              <div className={`send-mode-control mode-${sendMode}`}>
                {props.onCycleSendMode ? (
                  <button
                    type="button"
                    className="send-mode-toggle"
                    onClick={() => props.onCycleSendMode?.()}
                    aria-label={`发送模式 ${sendModeLabel}`}
                    title={
                      sendMode === "insert"
                        ? "插入 · Enter 打断当前流 · Alt+Enter 切队列"
                        : "队列 · Enter 等本轮结束 · Alt+Enter 切插入"
                    }
                  >
                    <span className="send-mode-name">{sendModeLabel}</span>
                    <kbd className="send-mode-kbd">
                      {sendMode === "insert" ? "⌃↵" : "↵"}
                    </kbd>
                  </button>
                ) : null}
                {showStop ? (
                  <button
                    type="button"
                    className="ghost wire-icon-btn wire-composer-stop"
                    onClick={() => props.onStop?.()}
                    disabled={!props.onStop}
                    title="停止并清空排队 · 输入文字可改为发送"
                    aria-label="停止"
                  >
                    <ChromeMark kind="stop" size={14} decorative />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`send-btn wire-icon-btn wire-composer-send mode-${sendMode}`}
                  disabled={!canSend}
                  onClick={() => {
                    cancelFlush();
                    props.onSend();
                  }}
                  aria-label={
                    props.busy
                      ? sendMode === "insert"
                        ? "插入发送"
                        : "排队发送"
                      : "发送"
                  }
                >
                  <ChromeMark kind="send" size={15} decorative />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
