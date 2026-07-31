/**
 * CLI logo language (cli/src/gallery/maou-logo.ts + tui-ratatui maou_logo.rs).
 *
 * Seal: terminal half-cell square = 2 cols; 1 → block, 0 → empty.
 * Compact 3-row seal (live TUI) + title bar:
 *   ██      ██  │  MAOU-AGENT
 *     ██  ██    │
 *   ██  ██  ██  │  v …
 */
import React from "react";

const SEAL_BITMAP = ["10001", "01010", "10101"] as const;

const TITLE = "MAOU-AGENT";
/** Align with cli package when available; draft falls back */
const DEFAULT_VERSION = "0.1.0";

export type MaouLogoProps = {
  /** show version under title (CLI style) */
  version?: string;
  compact?: boolean;
  className?: string;
};

function SealGrid({ className }: { className?: string }) {
  return (
    <span className={className ?? "maou-seal"} aria-hidden>
      {SEAL_BITMAP.map((row, ri) => (
        <span key={ri} className="maou-seal-row">
          {row.split("").map((bit, ci) => (
            <span
              key={ci}
              className={`maou-seal-cell${bit === "1" ? " is-on" : ""}`}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

export function MaouLogo({
  version = DEFAULT_VERSION,
  compact = false,
  className,
}: MaouLogoProps) {
  const ver =
    version.startsWith("v") || version.startsWith("V")
      ? version
      : `v ${version}`;

  return (
    <span
      className={`maou-logo${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}
      title={`${TITLE} ${ver}`}
      role="img"
      aria-label={`${TITLE} ${ver}`}
    >
      <SealGrid />
      <span className="maou-logo-bar" aria-hidden />
      <span className="maou-logo-text">
        <span className="maou-logo-title">{TITLE}</span>
        {!compact ? <span className="maou-logo-ver">{ver}</span> : null}
      </span>
    </span>
  );
}
