import React from "react";
import type { ComposerOutboxItem, ComposerProps } from "./types";

export function QueueDock(props: ComposerProps) {
  const queued = props.outbox.filter((o) => o.status === "queued");
  const failed = props.outbox.filter((o) => o.status === "failed");
  if (props.outbox.length === 0) return null;

  return (
    <div className="composer-queue composer-outbox" data-composer-queue="" role="list" aria-label="待发送与排队">
      <div className="composer-queue-head">
        <span className="composer-queue-title">
          {queued.length > 0 ? `${queued.length} 条排队` : "发送失败"}
          {failed.length > 0 && queued.length > 0 ? ` · ${failed.length} 失败` : ""}
        </span>
        {queued.length > 0 && props.onClearOutbox ? (
          <button
            type="button"
            className="ghost composer-queue-clear"
            onClick={() => props.onClearOutbox?.()}
          >
            清空
          </button>
        ) : null}
      </div>
      <ul className="composer-queue-list composer-outbox-list">
        {props.outbox.map((item) => (
          <QueueRow key={item.localId} item={item} props={props} />
        ))}
      </ul>
    </div>
  );
}

function QueueRow({
  item,
  props,
}: {
  item: ComposerOutboxItem;
  props: ComposerProps;
}) {
  return (
    <li
      className={`composer-queue-item composer-outbox-item is-${item.status}${item.locked ? " is-locked" : ""}`}
      role="listitem"
    >
      <span className="composer-queue-mode composer-outbox-mode">
        {item.status === "failed"
          ? "失败"
          : item.mode === "insert"
            ? "插入"
            : "队列"}
      </span>
      <span className="composer-queue-text composer-outbox-text" title={item.error || item.text}>
        {item.locked ? "锁 · " : ""}
        {item.text}
      </span>
      <span className="composer-queue-actions composer-outbox-actions">
        {item.status === "queued" && props.onSteerOutbox ? (
          <button
            type="button"
            className="ghost"
            onClick={() => props.onSteerOutbox?.(item)}
            title="插入当前轮"
          >
            插入
          </button>
        ) : null}
        {item.status === "failed" && props.onRetryOutbox ? (
          <button
            type="button"
            className="ghost"
            onClick={() => props.onRetryOutbox?.(item)}
          >
            重试
          </button>
        ) : null}
        {props.onRemoveOutbox ? (
          <button
            type="button"
            className="ghost"
            onClick={() => props.onRemoveOutbox?.(item)}
            title="移除"
          >
            ×
          </button>
        ) : null}
      </span>
    </li>
  );
}
