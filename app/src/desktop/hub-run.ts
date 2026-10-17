/**
 * 桌面 hub 进程：只听 socket，不碰窗口。
 */

import { createAppServer } from "../server/create-server.js";
import { HUB_READY_LINE } from "./hub-ready.js";

export { HUB_READY_LINE };

/** 桌面 hub 开机停在 ops；`MAOU_APP_INITIAL_AGENT` 可改（空串 = 走 hub 默认）。 */
export const DESKTOP_INITIAL_SWITCH_ID = "system:ops";

export type HubHandle = {
  close: () => Promise<void>;
};

export async function startHub(opts: {
  socketPath: string;
  projectRoot: string;
  sandboxMode?: string;
  initialSwitchId?: string;
}): Promise<HubHandle> {
  const socketPath = opts.socketPath.trim();
  if (!socketPath) throw new Error("socketPath required");
  const server = createAppServer({
    listen: { kind: "socket", path: socketPath },
    projectRoot: opts.projectRoot,
    sandboxMode: opts.sandboxMode || "yolo",
    // 聊天模式开机就要 ops（live-state 会强切），从这儿开始省掉一次建 coding + 切换 + 两次重挂
    initialSwitchId: opts.initialSwitchId ?? DESKTOP_INITIAL_SWITCH_ID,
  });
  await server.start();
  return { close: () => server.close() };
}

export async function runHubFromEnv(): Promise<void> {
  const socketPath = process.env.MAOU_APP_SOCKET?.trim() ?? "";
  if (!socketPath) throw new Error("MAOU_APP_SOCKET required");
  const projectRoot = process.env.MAOU_PROJECT_ROOT?.trim() || process.cwd();
  const sandboxMode = process.env.MAOU_SANDBOX_MODE || "yolo";
  const initialSwitchId = process.env.MAOU_APP_INITIAL_AGENT?.trim() ?? DESKTOP_INITIAL_SWITCH_ID;
  const hub = await startHub({ socketPath, projectRoot, sandboxMode, initialSwitchId });
  process.stdout.write(`${HUB_READY_LINE}\n`);

  await new Promise<void>((resolve) => {
    let closed = false;
    const stop = () => {
      if (closed) return;
      closed = true;
      void hub.close().finally(() => resolve());
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    process.on("disconnect", stop);
    // 壳持有 stdin 管道；壳被强杀时管道断开，这里读到 EOF 就收掉，不留孤儿
    if (process.env.MAOU_HUB_PARENT_STDIN === "1") {
      process.stdin.on("end", stop);
      process.stdin.on("error", stop);
      process.stdin.resume();
    }
  });
}
