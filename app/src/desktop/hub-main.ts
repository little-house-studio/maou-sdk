/**
 * Tauri 壳（src-tauri/src/hub.rs）拉起的 Node 入口。只跑 AgentHub HTTP/WS。
 */

import { runHubFromEnv } from "./hub-run.js";

// close 完就退：stdin 监听、Agent 定时器等句柄不该把进程吊住
void runHubFromEnv().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`[maou-hub] ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  },
);
