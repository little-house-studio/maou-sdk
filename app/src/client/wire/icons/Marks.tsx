/**
 * Shared SVG marks — shape encodes kind; CSS tone class encodes color.
 * Accessible: title/aria-label always present when decorative=false.
 */
import React, { type ReactNode } from "react";
import type {
  ChromeMarkKind,
  HierarchyMarkKind,
  RoleMarkKind,
  StatusMarkKind,
  TaskMarkKind,
  VisualTone,
} from "../visual-marks";
import {
  fileTone,
  hierarchyTone,
  statusShape,
  statusTone,
} from "../visual-marks";
import type { FileIconKind } from "../sidebar/file-tree";

type MarkProps = {
  size?: number;
  className?: string;
  title?: string;
  decorative?: boolean;
};

function Svg({
  size = 14,
  className = "",
  title,
  decorative,
  children,
  viewBox = "0 0 16 16",
}: MarkProps & { children: ReactNode; viewBox?: string }) {
  return (
    <svg
      className={`draft-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={decorative || !title ? true : undefined}
      role={decorative || !title ? undefined : "img"}
    >
      {title && !decorative ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

function strokeProps(sw = 1.5) {
  return {
    stroke: "currentColor",
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function StatusMark({
  kind,
  size = 12,
  className = "",
  title,
  decorative,
}: MarkProps & { kind: StatusMarkKind }) {
  const tone = statusTone(kind);
  const shape = statusShape(kind);
  const t = decorative ? undefined : title ?? kind;
  const cls = `tone-${tone} shape-${shape} ${className}`;

  if (shape === "pulse") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        <circle cx="8" cy="8" r="3.2" fill="currentColor" />
        <circle
          cx="8"
          cy="8"
          r="6"
          stroke="currentColor"
          strokeWidth="1.2"
          opacity="0.45"
          className="draft-mark-pulse-ring"
        />
      </Svg>
    );
  }
  if (shape === "check") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        <circle cx="8" cy="8" r="6" {...strokeProps(1.4)} />
        <path d="M5 8.2 L7.1 10.2 L11.2 5.8" {...strokeProps(1.5)} />
      </Svg>
    );
  }
  if (shape === "ring") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        <circle cx="8" cy="8" r="5.5" {...strokeProps(1.6)} />
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      </Svg>
    );
  }
  if (shape === "diamond") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        <path d="M8 2.2 L13.5 8 L8 13.8 L2.5 8 Z" {...strokeProps(1.4)} />
      </Svg>
    );
  }
  if (shape === "slash") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        <circle cx="8" cy="8" r="6" {...strokeProps(1.4)} />
        <path d="M5 5 L11 11" {...strokeProps(1.6)} />
      </Svg>
    );
  }
  return (
    <Svg size={size} className={cls} title={t} decorative={decorative}>
      <circle cx="8" cy="8" r="3" fill="currentColor" />
    </Svg>
  );
}

/**
 * Unified minimalist role marks: monoline glyphs only.
 * Circle shell is provided by CSS (.msg-avatar-wrap), not the SVG.
 */
export function RoleAvatar({
  kind,
  size = 24,
  className = "",
  title,
}: MarkProps & { kind: RoleMarkKind }) {
  const t = title ?? kind;
  const cls = `draft-role-avatar role-${kind} ${className}`.trim();
  const s = strokeProps(1.5);

  // All share the same visual weight: outline geometry, no filled discs
  if (kind === "user") {
    return (
      <Svg size={size} className={cls} title={t} viewBox="0 0 24 24">
        <circle cx="12" cy="9" r="3" {...s} />
        <path d="M6.8 18c1.1-2.4 2.9-3.6 5.2-3.6s4.1 1.2 5.2 3.6" {...s} />
      </Svg>
    );
  }
  if (kind === "assistant") {
    return (
      <Svg size={size} className={cls} title={t} viewBox="0 0 24 24">
        <rect x="6" y="7" width="12" height="10" rx="2.5" {...s} />
        <circle cx="10" cy="11.5" r="0.9" fill="currentColor" />
        <circle cx="14" cy="11.5" r="0.9" fill="currentColor" />
        <path d="M12 7V5.5" {...s} />
      </Svg>
    );
  }
  if (kind === "tool") {
    return (
      <Svg size={size} className={cls} title={t} viewBox="0 0 24 24">
        <path d="M14.2 7.2l2.6 2.6-7.6 7.6H6.6v-2.6L14.2 7.2z" {...s} />
        <path d="M12.8 8.6l2.6 2.6" {...s} />
      </Svg>
    );
  }
  if (kind === "err") {
    return (
      <Svg size={size} className={cls} title={t} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="7.5" {...s} />
        <path d="M12 8.5v4.2" {...s} />
        <circle cx="12" cy="15.6" r="0.85" fill="currentColor" />
      </Svg>
    );
  }
  if (kind === "thinking") {
    return (
      <Svg size={size} className={cls} title={t} viewBox="0 0 24 24">
        <circle cx="8" cy="12" r="1.15" {...s} />
        <circle cx="12" cy="12" r="1.15" {...s} />
        <circle cx="16" cy="12" r="1.15" {...s} />
      </Svg>
    );
  }
  return (
    <Svg size={size} className={cls} title={t} viewBox="0 0 24 24">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" {...s} />
      <path d="M9 12h6" {...s} />
    </Svg>
  );
}

export function HierarchyMark({
  kind,
  size = 12,
  className = "",
  title,
}: MarkProps & { kind: HierarchyMarkKind }) {
  const tone = hierarchyTone(kind);
  const t = title ?? kind;
  const cls = `tone-${tone} ${className}`;
  // Distinct shapes: filled diamond system root, hollow diamond child,
  // filled circle project root, hollow circle project child
  if (kind === "system_root") {
    return (
      <Svg size={size} className={cls} title={t}>
        <path d="M8 2 L14 8 L8 14 L2 8 Z" fill="currentColor" />
      </Svg>
    );
  }
  if (kind === "system_child") {
    return (
      <Svg size={size} className={cls} title={t}>
        <path d="M8 3 L13 8 L8 13 L3 8 Z" {...strokeProps(1.4)} />
      </Svg>
    );
  }
  if (kind === "project_root") {
    return (
      <Svg size={size} className={cls} title={t}>
        <circle cx="8" cy="8" r="5" fill="currentColor" />
      </Svg>
    );
  }
  return (
    <Svg size={size} className={cls} title={t}>
      <circle cx="8" cy="8" r="4.5" {...strokeProps(1.5)} />
    </Svg>
  );
}

/** Minimal monoline file/folder marks — type via shape, not letter badges. */
export function FileMark({
  kind,
  size = 14,
  className = "",
  title,
  decorative,
}: MarkProps & { kind: FileIconKind }) {
  const tone = fileTone(kind);
  const t = decorative ? undefined : title ?? kind;
  const cls =
    `draft-file-mark draft-file-kind-${kind} tone-${tone} ${className}`.trim();
  const s = strokeProps(1.4);

  if (kind === "folder" || kind === "folder-open") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        <path
          d={
            kind === "folder-open"
              ? "M1.5 5h4l1.2 1.3H14a.8.8 0 0 1 .8.8V12a1.2 1.2 0 0 1-1.2 1.2H2.7A1.2 1.2 0 0 1 1.5 12V5.8A.8.8 0 0 1 2.3 5H1.5z"
              : "M1.5 5.5h4l1.3 1.3H14a.8.8 0 0 1 .8.8V12a1.2 1.2 0 0 1-1.2 1.2H2.7A1.2 1.2 0 0 1 1.5 12V6.3A.8.8 0 0 1 2.3 5.5H1.5z"
          }
          {...s}
        />
      </Svg>
    );
  }

  // shared document outline
  const doc = (
    <>
      <path
        d="M4 2.5h5.2L12.5 5.8V13a1.2 1.2 0 0 1-1.2 1.2H4A1 1 0 0 1 3 13.2V3.5A1 1 0 0 1 4 2.5z"
        {...s}
      />
      <path d="M9.2 2.5V5.6H12.5" {...s} />
    </>
  );

  if (kind === "ts" || kind === "tsx" || kind === "js" || kind === "jsx") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        {doc}
        <path d="M5.5 9.2h5M5.5 11.2h3.5" {...s} />
      </Svg>
    );
  }
  if (kind === "json" || kind === "config") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        {doc}
        <path d="M6 9.5c.6-1 1.2-1.2 1.8 0M8.2 9.5c.6 1 1.2 1.2 1.8 0" {...s} />
      </Svg>
    );
  }
  if (kind === "md") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        {doc}
        <path d="M5.5 9h5M5.5 11h3" {...s} />
      </Svg>
    );
  }
  if (kind === "html" || kind === "css") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        {doc}
        <path d="M6.2 10.2l1.3-1.6 1.3 1.6M9.2 10.2l1.2 1.4" {...s} />
      </Svg>
    );
  }
  if (kind === "git") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        <circle cx="5.5" cy="11" r="1.4" {...s} />
        <circle cx="10.5" cy="5" r="1.4" {...s} />
        <circle cx="10.5" cy="11" r="1.4" {...s} />
        <path d="M5.5 9.6V6.8A2 2 0 0 1 7.5 4.8h1.5" {...s} />
        <path d="M10.5 6.4v3.2" {...s} />
      </Svg>
    );
  }
  if (kind === "lock") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        {doc}
        <path d="M6.5 10.2V9a1.5 1.5 0 0 1 3 0v1.2" {...s} />
        <rect x="6" y="10.2" width="4" height="2.8" rx="0.5" {...s} />
      </Svg>
    );
  }
  if (kind === "img") {
    return (
      <Svg size={size} className={cls} title={t} decorative={decorative}>
        <rect x="3" y="4" width="10" height="8" rx="1.2" {...s} />
        <circle cx="6.2" cy="7" r="1" {...s} />
        <path d="M3.8 11.2l2.4-2.2 1.6 1.4 2.2-2.4 2.2 3.2" {...s} />
      </Svg>
    );
  }

  return (
    <Svg size={size} className={cls} title={t} decorative={decorative}>
      {doc}
    </Svg>
  );
}

export function TaskMark({
  status,
  size = 12,
  className = "",
}: MarkProps & { status: "running" | "done" | "queued" }) {
  const kind: StatusMarkKind =
    status === "running" ? "running" : status === "done" ? "done" : "queued";
  return <StatusMark kind={kind} size={size} className={className} title={status} />;
}

export function ChromeMark({
  kind,
  size = 14,
  className = "",
  title,
}: MarkProps & { kind: ChromeMarkKind }) {
  const t = title ?? kind;
  const tone: VisualTone =
    kind === "stop" || kind === "diff"
      ? "warn"
      : kind === "send" || kind === "brand"
        ? "accent"
        : kind === "usage"
          ? "info"
          : "muted";
  const cls = `tone-${tone} ${className}`;

  switch (kind) {
    case "brand":
      return (
        <Svg size={size} className={cls} title={t}>
          <rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" />
        </Svg>
      );
    case "mode_chat":
      return (
        <Svg size={size} className={cls} title={t}>
          <path
            d="M3 4.5h10a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H7l-3 2.5V5.5a1 1 0 0 1 1-1z"
            {...strokeProps(1.4)}
          />
        </Svg>
      );
    case "mode_project":
      return (
        <Svg size={size} className={cls} title={t}>
          <path
            d="M2.5 5h4l1.2 1.5H13.5V12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 1.5 12V6.5A1.5 1.5 0 0 1 3 5h-.5z"
            {...strokeProps(1.4)}
          />
        </Svg>
      );
    case "mode_plugins":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" {...strokeProps(1.3)} />
        </Svg>
      );
    case "mode_proactive":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M8 2.5v3" {...strokeProps(1.4)} />
          <path d="M8 10.5v3" {...strokeProps(1.4)} />
          <path d="M2.5 8h3" {...strokeProps(1.4)} />
          <path d="M10.5 8h3" {...strokeProps(1.4)} />
          <circle cx="8" cy="8" r="2.4" {...strokeProps(1.4)} />
        </Svg>
      );
    case "new":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M8 3.5v9M3.5 8h9" {...strokeProps(1.6)} />
        </Svg>
      );
    case "stop":
      return (
        <Svg size={size} className={cls} title={t}>
          <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" />
        </Svg>
      );
    case "refresh":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M3.5 8a4.5 4.5 0 0 1 7.6-3.2" {...strokeProps(1.4)} />
          <path d="M12.5 8a4.5 4.5 0 0 1-7.6 3.2" {...strokeProps(1.4)} />
          <path d="M11 2.8v3.2h3.2M5 13.2v-3.2H1.8" {...strokeProps(1.4)} />
        </Svg>
      );
    case "settings":
      return (
        <Svg size={size} className={cls} title={t}>
          <circle cx="8" cy="8" r="2.2" {...strokeProps(1.3)} />
          <path
            d="M8 2.5v1.4M8 12.1v1.4M2.5 8h1.4M12.1 8h1.4M4 4l1 1M11 11l1 1M12 4l-1 1M5 11l-1 1"
            {...strokeProps(1.3)}
          />
        </Svg>
      );
    case "files":
      return (
        <Svg size={size} className={cls} title={t}>
          <path
            d="M3 4h4l1.5 1.5H13v7.5A1.5 1.5 0 0 1 11.5 14.5h-8A1.5 1.5 0 0 1 2 13V5.5A1.5 1.5 0 0 1 3.5 4H3z"
            {...strokeProps(1.3)}
          />
        </Svg>
      );
    case "scenario":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M3 4h10M3 8h7M3 12h10" {...strokeProps(1.5)} />
        </Svg>
      );
    case "usage":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M3 12V8.5M6.5 12V5M10 12V7M13.5 12V4" {...strokeProps(1.5)} />
        </Svg>
      );
    case "send":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M3 8h9M9 4.5L12.5 8 9 11.5" {...strokeProps(1.6)} />
        </Svg>
      );
    case "retry":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M4 8a4 4 0 1 0 1.2-2.8" {...strokeProps(1.4)} />
          <path d="M3 3.5v3h3" {...strokeProps(1.4)} />
        </Svg>
      );
    case "copy":
      return (
        <Svg size={size} className={cls} title={t}>
          <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" {...strokeProps(1.3)} />
          <path d="M4 10.5V4.5A1.5 1.5 0 0 1 5.5 3H11" {...strokeProps(1.3)} />
        </Svg>
      );
    case "terminal":
      return (
        <Svg size={size} className={cls} title={t}>
          <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" {...strokeProps(1.3)} />
          <path d="M5 7l2 1.5L5 10M8.5 10.5H11" {...strokeProps(1.3)} />
        </Svg>
      );
    case "agent_info":
      return (
        <Svg size={size} className={cls} title={t}>
          <circle cx="8" cy="6" r="2.3" {...strokeProps(1.3)} />
          <path d="M3.5 13c.8-2.2 2.3-3.3 4.5-3.3s3.7 1.1 4.5 3.3" {...strokeProps(1.3)} />
        </Svg>
      );
    case "diff":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M4 3.5v9M12 3.5v9M4 8h3M9 8h3" {...strokeProps(1.4)} />
        </Svg>
      );
    case "tasks":
      return (
        <Svg size={size} className={cls} title={t}>
          <path d="M3.5 5h9M3.5 8h9M3.5 11h6" {...strokeProps(1.5)} />
          <circle cx="12.5" cy="11" r="1.5" fill="currentColor" />
        </Svg>
      );
    case "session":
      return (
        <Svg size={size} className={cls} title={t}>
          <path
            d="M4 3.5h8a1 1 0 0 1 1 1V12l-2.2-1.5H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"
            {...strokeProps(1.3)}
          />
        </Svg>
      );
    case "folder_group":
      return (
        <Svg size={size} className={cls} title={t}>
          <path
            d="M2 5h4l1.2 1.2H14v6.3A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5V5z"
            fill="currentColor"
            opacity="0.85"
          />
        </Svg>
      );
    default:
      return (
        <Svg size={size} className={cls} title={t}>
          <circle cx="8" cy="8" r="3" fill="currentColor" />
        </Svg>
      );
  }
}

/** Small muted “changed” pip — not a loud warning icon. */
export function ModifiedMark({ size = 8, className = "", decorative }: MarkProps) {
  return (
    <Svg
      size={size}
      className={`draft-file-mod tone-muted ${className}`.trim()}
      title={decorative ? undefined : "已修改"}
      decorative={decorative}
    >
      <circle cx="8" cy="8" r="3.2" fill="currentColor" opacity="0.85" />
    </Svg>
  );
}
