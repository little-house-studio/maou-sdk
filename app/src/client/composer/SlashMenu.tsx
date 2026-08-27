import React from "react";
import { ComposerOverlay } from "./CommandPalette";
import type { ComposerProps } from "./types";

export function SlashMenu(props: ComposerProps) {
  return <ComposerOverlay {...props} />;
}
