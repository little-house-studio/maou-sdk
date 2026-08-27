import React, { useLayoutEffect, useRef, useState } from "react";
import { textareaIndexRect, type CaretBox } from "./caret";
import { CommandFlyout } from "./CommandFlyout";
import { commandByName, slashTokenStart } from "./commands";
import type { ComposerProps } from "./types";

export function CommandLauncher(props: ComposerProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [caret, setCaret] = useState<CaretBox | null>(null);
  const items = props.paletteOpen
    ? (props.paletteHits ?? [])
    : props.slashHits
        .map((n) => commandByName(n, props.paletteHits) ?? commandByName(n))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const slashOpen = Boolean(props.slashOpen && !props.paletteOpen);
  const open = Boolean((slashOpen || props.paletteOpen) && items.length > 0);
  const idx = props.paletteOpen
    ? (props.paletteIdx ?? 0)
    : props.slashIdx;

  useLayoutEffect(() => {
    if (!slashOpen) {
      setCaret(null);
      return;
    }
    const el = props.inputRef.current;
    if (!el) {
      setCaret(null);
      return;
    }
    const start = slashTokenStart(el.value, el.selectionStart ?? 0);
    if (start == null) {
      setCaret(null);
      return;
    }
    setCaret(textareaIndexRect(el, start));
  }, [
    slashOpen,
    props.input,
    props.slashHits,
    props.slashIdx,
    props.inputRef,
  ]);

  return (
    <div className="composer-cmd-wrap">
      <button
        ref={btnRef}
        type="button"
        className="composer-cmd"
        data-composer-launch=""
        aria-label="命令"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="命令 · Ctrl+K"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          props.onCommandLaunch();
          props.inputRef.current?.focus();
        }}
      >
        <span aria-hidden>+</span>
      </button>
      <CommandFlyout
        open={open}
        anchor={props.paletteOpen ? btnRef.current : null}
        caret={slashOpen ? caret : null}
        items={items}
        activeIdx={idx}
        onPick={(name) => {
          if (props.paletteOpen) props.onPalettePick?.(name);
          else props.onSlashPick?.(name);
        }}
      />
    </div>
  );
}
