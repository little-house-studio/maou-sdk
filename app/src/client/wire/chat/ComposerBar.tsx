import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "../../composer";
import type { ComposerProps } from "../../composer";
import {
  applyMentionPick,
  filterMentionHits,
  filterPaletteHits,
  filterSlashHits,
  mentionQuery,
  overlayIdxAfterPrefix,
  overlayKeyAction,
  slashPrefixAtCursor,
  stripSlashToken,
  composeCommandInput,
} from "../../composer/commands";
import { fitComposerHeight } from "../../composer/fit-height";
import {
  clipboardToComposerImages,
  mergeComposerImages,
  type ComposerImage,
} from "../../composer/images";
import type { DraftAgent, DraftMeta } from "../types";

export type ComposerBarProps = {
  draftInput: string;
  agentBusy: boolean;
  pendingApproval: boolean;
  meta: DraftMeta;
  statusHint: string;
  usageLabel: string;
  hasActiveSession: boolean;
  agents: DraftAgent[];
  canRetry: boolean;
  filePaths?: readonly string[];
  onDraftInputChange: (v: string) => void;
  onSend: (images?: ComposerImage[], text?: string) => void;
  onRetryLast: () => void;
  onCopyTranscript: () => void;
  onAgentChange: (agentId: string) => void;
  onApprovalModeChange: (mode: string) => void;
  /** Draft local stop — clears busy without live agent. */
  onStop?: () => void;
};

/**
 * Draft station adapter — same Composer as live, fixture props in.
 */
export function ComposerBar({
  draftInput,
  agentBusy,
  pendingApproval,
  meta,
  statusHint,
  usageLabel,
  hasActiveSession,
  agents,
  canRetry,
  filePaths = [],
  onDraftInputChange,
  onSend,
  onRetryLast,
  onCopyTranscript,
  onAgentChange,
  onApprovalModeChange,
  onStop,
}: ComposerBarProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputEpoch, setInputEpoch] = useState(0);
  const [slashIdx, setSlashIdx] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [commandBlock, setCommandBlock] = useState<string | null>(null);
  const [commandBlockSelected, setCommandBlockSelected] = useState(false);
  const [cursor, setCursor] = useState(0);
  const slashPrefixRef = useRef<string | null>(null);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const statusError =
    statusHint.includes("拒绝") ||
    statusHint.includes("错误") ||
    /error|denied/i.test(statusHint);
  const placeholder = pendingApproval
    ? "可先输入下一条… 处理审批后发送"
    : agentBusy
      ? "运行中也可输入… Enter 发送（草稿本地回显）"
      : hasActiveSession
        ? "输入消息… Enter 发送，Shift+Enter 换行 · / 命令 · Ctrl+K"
        : "输入消息将自动创建本地会话…";

  useEffect(() => {
    const el = inputRef.current;
    if (el) fitComposerHeight(el);
  }, [draftInput]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setPaletteOpen((v) => !v);
        setPaletteIdx(0);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slashHits = useMemo(
    () => filterSlashHits(draftInput, undefined, 8, cursor),
    [draftInput, cursor],
  );
  const mentionQ = mentionQuery(draftInput);
  const mentionHits = useMemo(
    () => (mentionQ != null ? filterMentionHits(mentionQ, filePaths) : []),
    [mentionQ, filePaths],
  );
  const paletteHits = useMemo(
    () => filterPaletteHits(draftInput),
    [draftInput],
  );
  const slashOpen =
    !commandBlock &&
    !overlayDismissed &&
    !paletteOpen &&
    slashPrefixAtCursor(draftInput, cursor) != null &&
    slashHits.length > 0;
  const mentionOpen =
    !overlayDismissed && !paletteOpen && !slashOpen && mentionQ != null;

  const applySlash = (cmd: string) => {
    const live = inputRef.current?.value ?? draftInput;
    const at = inputRef.current?.selectionStart ?? live.length;
    const rest = commandBlock ? live : stripSlashToken(live, at);
    setCommandBlock(cmd);
    setCommandBlockSelected(false);
    onDraftInputChange(rest);
    setInputEpoch((n) => n + 1);
    setPaletteOpen(false);
    setOverlayDismissed(true);
    inputRef.current?.focus();
  };

  const sendDraft = () => {
    const live = inputRef.current?.value ?? draftInput;
    const text = composeCommandInput(commandBlock, live);
    if (!text.trim() && !images.length) return;
    onSend(images, text);
    onDraftInputChange("");
    setCommandBlock(null);
    setCommandBlockSelected(false);
    setInputEpoch((n) => n + 1);
    setImages([]);
  };

  const onCommandLaunch = useCallback(() => {
    setPaletteOpen((v) => !v);
    setPaletteIdx(0);
    setOverlayDismissed(false);
    inputRef.current?.focus();
  }, []);

  const onOverlayDismiss = useCallback(() => {
    setPaletteOpen(false);
    setOverlayDismissed(true);
  }, []);

  const bag: ComposerProps = {
    variant: "draft",
    input: draftInput,
    inputEpoch,
    busy: agentBusy,
    pendingApproval,
    sendMode: "queue",
    placeholder,
    statusDisplay: pendingApproval
      ? "等待审批"
      : agentBusy
        ? "运行中"
        : /已恢复/.test(statusHint)
          ? ""
          : statusHint,
    statusError,
    slashHits,
    slashIdx,
    slashOpen,
    paletteOpen,
    paletteHits,
    paletteIdx,
    mentionOpen,
    mentionHits,
    mentionIdx,
    filePaths,
    images,
    outbox: [],
    provider: meta.provider,
    model: meta.model,
    providers: [],
    models: [],
    approval: meta.sandboxMode || "yolo",
    contextPct: null,
    canRetry,
    canSteerQueue: false,
    inputRef,
    agents,
    agentName: meta.agentName,
    usageLabel,
    commandBlock,
    commandBlockSelected,
    onCommandBlockChange: setCommandBlock,
    onCommandBlockSelect: setCommandBlockSelected,
    onCursorChange: (n) => setCursor(n),
    onInputChange: (v) => {
      onDraftInputChange(v);
      const at = inputRef.current?.selectionStart ?? v.length;
      setCursor(at);
      const prefix = slashPrefixAtCursor(v, at);
      setSlashIdx((idx) =>
        overlayIdxAfterPrefix(slashPrefixRef.current, prefix, idx),
      );
      slashPrefixRef.current = prefix;
      setMentionIdx(0);
      setOverlayDismissed(false);
      if (
        paletteOpen &&
        slashPrefixAtCursor(
          v,
          inputRef.current?.selectionStart ?? v.length,
        ) == null
      ) {
        setPaletteOpen(false);
      }
    },
    onInputKeyDown: (e) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      const hits = paletteOpen
        ? paletteHits.map((c) => c.name)
        : mentionOpen
          ? mentionHits
          : slashHits;
      const idx = paletteOpen ? paletteIdx : mentionOpen ? mentionIdx : slashIdx;
      const setIdx = paletteOpen
        ? setPaletteIdx
        : mentionOpen
          ? setMentionIdx
          : setSlashIdx;
      if ((slashOpen || paletteOpen || mentionOpen) && hits.length > 0) {
        const act = overlayKeyAction(
          e,
          true,
          hits.length,
        );
        if (act === "nav-down") {
          e.preventDefault();
          setIdx((i) => (i + 1) % hits.length);
          return;
        }
        if (act === "nav-up") {
          e.preventDefault();
          setIdx((i) => (i - 1 + hits.length) % hits.length);
          return;
        }
        if (act === "pick") {
          e.preventDefault();
          const pick = hits[Math.min(idx, hits.length - 1)];
          if (pick) {
            if (mentionOpen) {
              onDraftInputChange(
                applyMentionPick(inputRef.current?.value ?? draftInput, pick),
              );
              setInputEpoch((n) => n + 1);
            } else applySlash(pick);
          }
          return;
        }
        if (act === "close") {
          e.preventDefault();
          setPaletteOpen(false);
          setOverlayDismissed(true);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const live = inputRef.current?.value ?? draftInput;
        if (composeCommandInput(commandBlock, live).trim() || images.length) {
          sendDraft();
        }
      }
    },
    onSend: sendDraft,
    onInputPaste: (e) => {
      const dt = e.clipboardData;
      const hasImg = Boolean(
        dt &&
          ([...dt.files].some((f) => f.type.startsWith("image/")) ||
            [...dt.items].some(
              (it) => it.kind === "file" && it.type.startsWith("image/"),
            )),
      );
      if (!hasImg) return;
      e.preventDefault();
      void clipboardToComposerImages(dt, images.length).then((extra) => {
        if (!extra.length) return;
        setImages((prev) => mergeComposerImages(prev, extra));
      });
    },
    onImagesChange: setImages,
    onStop,
    onSlashPick: applySlash,
    onSlashHighlight: setSlashIdx,
    onPalettePick: applySlash,
    onPaletteHighlight: setPaletteIdx,
    onMentionPick: (path) => {
      onDraftInputChange(
        applyMentionPick(inputRef.current?.value ?? draftInput, path),
      );
      setInputEpoch((n) => n + 1);
      inputRef.current?.focus();
    },
    onCommandLaunch,
    onOverlayDismiss,
    onApprovalChange: onApprovalModeChange,
    onRetryLast,
    onCopyTranscript,
    onAgentChange,
  };

  return <Composer {...bag} />;
}
