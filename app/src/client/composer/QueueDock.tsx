import React, { useId, useState } from "react";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, X, Pencil, CornerDownRight } from "lucide-react";
import type { ComposerOutboxItem, ComposerProps } from "./types";

export function QueueDock(props: ComposerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const listId = useId();
  const waiting = props.outbox.filter(o => o.status !== "failed");
  const queued = props.outbox.filter(o => o.status === "queued");
  const failed = props.outbox.length - waiting.length;
  const signature = queued.map(o => o.localId).join("|");
  const confirming = confirm !== null && confirm === signature;
  const pending = props.queuePending || props.outbox.some(o => o.locked);
  const running = props.queueBusy ?? props.busy;
  if (!props.outbox.length && !props.queueSyncError) return null;

  return (
    <section className="composer-queue" data-composer-queue="" aria-label="消息队列">
      <div className="composer-queue-head">
        <button type="button" className="ghost composer-queue-toggle" onClick={() => setCollapsed(v => !v)} aria-expanded={!collapsed} aria-controls={listId}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span>消息队列</span>
          <span className="composer-queue-count">{waiting.length}{props.queueCapacity ? ` / ${props.queueCapacity}` : ""}</span>
          {failed > 0 && <span className="composer-queue-failed-count">{failed} 待重试</span>}
        </button>
        <div className="composer-queue-head-actions">
          {!running && queued.length > 0 && props.onResumeQueue && <button type="button" className="ghost composer-queue-resume" disabled={pending} onClick={props.onResumeQueue}><CornerDownRight size={13} />继续发送</button>}
          {queued.length > 0 && props.onClearOutbox && <button type="button" className="ghost composer-queue-clear" disabled={pending} onClick={() => { setConfirm(signature); setCollapsed(false); }}>清空</button>}
        </div>
      </div>
      {confirming && queued.length > 0 && <div className="composer-queue-confirm" role="alert">
        <span>移除这 {queued.length} 条待处理消息？</span>
        <button type="button" className="ghost" onClick={() => setConfirm(null)}>取消</button>
        <button type="button" className="ghost danger" disabled={pending} onClick={() => { setConfirm(null); props.onClearOutbox?.(); }}>确认清空</button>
      </div>}
      {props.queueSyncError && <div className="composer-queue-sync-error" role="status"><span>{props.queueSyncError}</span><button type="button" className="ghost" disabled={pending} onClick={props.onRefreshQueue}>重新同步</button></div>}
      <div id={listId} hidden={collapsed}>
        {waiting.length > 0 && <p className="composer-queue-hint" aria-live="polite">{running ? "按顺序在本轮结束后处理；插入会打断当前回复。" : "队列已暂停。继续发送后，将按顺序处理。"}</p>}
        <ol className="composer-queue-list">
          {props.outbox.map(item => <QueueRow key={item.localId} item={item} props={props} index={queued.findIndex(o => o.localId === item.localId)} total={queued.length} pending={Boolean(pending)} running={running} />)}
        </ol>
      </div>
    </section>
  );
}

function QueueRow({ item, props, index, total, pending, running }: {
  item: ComposerOutboxItem; props: ComposerProps; index: number; total: number; pending: boolean; running: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [saving, setSaving] = useState(false);
  const disabled = pending || saving || item.locked;
  const save = async () => {
    if (!draft.trim() || disabled) return;
    setSaving(true);
    try { if (await props.onEditOutbox?.(item, draft.trim())) setEditing(false); }
    finally { setSaving(false); }
  };
  const status = item.status === "sending" ? "入队中" : item.status === "failed" ? "待重试" : item.locked ? "更新中" : item.mode === "insert" ? "优先插入" : "等待处理";
  return <li className={`composer-queue-item is-${item.status}${item.locked ? " is-locked" : ""}`} aria-busy={Boolean(item.locked)}>
    <div className="composer-queue-row-head">
      <span className="composer-queue-order">{index >= 0 ? String(index + 1).padStart(2, "0") : "·"}</span>
      <span className="composer-queue-mode">{status}</span>
      <span className="composer-queue-actions">
        {item.status === "queued" && !editing && <>
          {props.onMoveOutbox && <>
            <button type="button" className="ghost" title="上移" aria-label="上移排队消息" disabled={disabled || index <= 0} onClick={() => props.onMoveOutbox?.(item, "up")}><ArrowUp size={13} /></button>
            <button type="button" className="ghost" title="下移" aria-label="下移排队消息" disabled={disabled || index >= total - 1} onClick={() => props.onMoveOutbox?.(item, "down")}><ArrowDown size={13} /></button>
          </>}
          {props.onEditOutbox && <button type="button" className="ghost" title="编辑" aria-label="编辑排队消息" disabled={disabled} onClick={() => { setDraft(item.text); setEditing(true); }}><Pencil size={13} /></button>}
          {props.onSteerOutbox && item.mode !== "insert" && running && <button type="button" className="ghost" disabled={disabled} onClick={() => props.onSteerOutbox?.(item)} title="打断当前回复，优先处理这条消息">插入</button>}
        </>}
        {item.status === "failed" && props.onRetryOutbox && <button type="button" className="ghost" disabled={disabled} onClick={() => props.onRetryOutbox?.(item)}>重试</button>}
        {!editing && props.onRemoveOutbox && <button type="button" className="ghost" disabled={disabled} onClick={() => props.onRemoveOutbox?.(item)} title="移除" aria-label="移除排队消息"><X size={14} /></button>}
      </span>
    </div>
    {editing ? <div className="composer-queue-editor">
      <textarea aria-label="编辑排队消息内容" autoFocus value={draft} disabled={saving} rows={3} onChange={e => setDraft(e.target.value)} onKeyDown={e => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
      }} />
      <div className="composer-queue-edit-actions"><span>⌘ / Ctrl + Enter 保存</span><button type="button" className="ghost" disabled={saving} onClick={() => setEditing(false)}>取消编辑</button><button type="button" className="ghost" disabled={disabled || !draft.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button></div>
    </div> : <button type="button" className={`composer-queue-text${expanded ? " is-expanded" : ""}`} onClick={() => setExpanded(v => !v)} aria-expanded={expanded} title={expanded ? "收起消息" : "展开完整消息"}>{item.text}</button>}
    {item.error && <p className="composer-queue-error" role="status">{item.error}</p>}
  </li>;
}
