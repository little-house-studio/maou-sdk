import React from "react";
import { commandByName } from "./commands";
import type { ComposerProps } from "./types";

export function CommandPalette(props: ComposerProps) {
  if (!props.paletteOpen || (props.paletteHits?.length ?? 0) === 0) return null;
  const hits = props.paletteHits ?? [];
  const sel = hits[Math.min(props.paletteIdx ?? 0, hits.length - 1)] ?? hits[0];
  return (
    <div
      className="composer-palette slash-menu"
      role="listbox"
      data-composer-overlay="palette"
      aria-label="命令面板"
    >
      {hits.map((cmd, i) => {
        const active = cmd.name === sel?.name || i === (props.paletteIdx ?? 0);
        return (
          <button
            key={cmd.name}
            type="button"
            className={`slash-item${active ? " active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPalettePick?.(cmd.name);
            }}
          >
            <span className="slash-item-cmd">/{cmd.name}</span>
            <span className="slash-item-label">{cmd.label}</span>
            <span className="slash-item-desc">{cmd.description}</span>
          </button>
        );
      })}
    </div>
  );
}

export function MentionMenu(props: ComposerProps) {
  if (!props.mentionOpen || (props.mentionHits?.length ?? 0) === 0) return null;
  const hits = props.mentionHits ?? [];
  const sel = hits[Math.min(props.mentionIdx ?? 0, hits.length - 1)] ?? hits[0];
  return (
    <div
      className="composer-mention slash-menu"
      role="listbox"
      data-composer-overlay="mention"
      aria-label="文件"
    >
      {hits.map((path, i) => (
        <button
          key={path}
          type="button"
          className={`slash-item${path === sel || i === (props.mentionIdx ?? 0) ? " active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            props.onMentionPick?.(path);
          }}
        >
          <span className="slash-item-cmd">@{path}</span>
        </button>
      ))}
    </div>
  );
}

export function ComposerOverlay(props: ComposerProps) {
  if (props.paletteOpen || props.slashOpen) return null;
  if (props.mentionOpen) return <MentionMenu {...props} />;
  const named = props.slashHits.map((n) => commandByName(n));
  if (!props.slashOpen || props.slashHits.length === 0) return null;
  const sel =
    props.slashHits[Math.min(props.slashIdx, props.slashHits.length - 1)] ??
    props.slashHits[0];
  return (
    <div
      className="slash-menu composer-slash"
      role="listbox"
      data-composer-overlay="slash"
    >
      {props.slashHits.map((s, i) => {
        const spec = named[i];
        return (
          <button
            key={s}
            type="button"
            className={`slash-item${s === sel || i === props.slashIdx ? " active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onSlashPick?.(s);
            }}
          >
            <span className="slash-item-cmd">/{s}</span>
            {spec ? (
              <span className="slash-item-label">{spec.label}</span>
            ) : null}
            {spec ? (
              <span className="slash-item-desc">{spec.description}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
