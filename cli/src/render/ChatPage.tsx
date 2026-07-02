/**
 * ChatPage —— 上下文窗口主区，委托 ScrollHistory 双缓冲渲染。
 */

import React from "react";
import { ScrollHistory } from "./ScrollHistory.js";

export function ChatPage({ frame }: { frame: number }) {
  return <ScrollHistory frame={frame} />;
}
