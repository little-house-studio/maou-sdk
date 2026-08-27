import React, { type ReactNode } from "react";
import { Composer } from "./Composer";
import { ComposerBar } from "./ComposerBar";
import { ComposerFooter } from "./ComposerFooter";
import { QueueDock } from "./QueueDock";
import { SlashMenu } from "./SlashMenu";
import {
  ApprovalSeat,
  AttachTool,
  ImageAttachTool,
  ModelSeat,
  MoreTools,
  PlanSeat,
  UsageSeat,
} from "./ComposerTools";
import type { ComposerProps } from "./types";

export function ConversationNodeSeat({ node }: { node?: ReactNode }) {
  return node ?? null;
}

export function ComposerSeat(props: ComposerProps) {
  return <Composer {...props} />;
}

export function ComposerBarSeat(props: ComposerProps) {
  return <ComposerBar {...props} />;
}

export function QueueDockSeat(props: ComposerProps) {
  return <QueueDock {...props} />;
}

export function ComposerFooterSeat(props: ComposerProps) {
  return <ComposerFooter {...props} />;
}

export function PlanToolSeat(props: ComposerProps) {
  return <PlanSeat {...props} />;
}

export function SlashSeat(props: ComposerProps) {
  return <SlashMenu {...props} />;
}

export function ModelToolSeat(props: ComposerProps) {
  return <ModelSeat {...props} />;
}

export function ApprovalToolSeat(props: ComposerProps) {
  return <ApprovalSeat {...props} />;
}

export function UsageToolSeat(props: ComposerProps) {
  return <UsageSeat {...props} />;
}

export function AttachToolSeat(props: ComposerProps) {
  return <AttachTool {...props} />;
}

export function ImageAttachSeat(props: ComposerProps) {
  return <ImageAttachTool {...props} />;
}

export function MoreToolsSeat(props: ComposerProps) {
  return <MoreTools {...props} />;
}
