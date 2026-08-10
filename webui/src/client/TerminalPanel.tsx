import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
/** 懒加载 chunk 自带 wire 样式，不依赖外层 CSS 是否已热更 */
import "./terminal-wire.css";
import {
  agentTerminalWsUrl,
  fetchTerminals,
  stopTerminal,
  type TerminalInfo,
} from "./api";

export type OpenTerminalRequest = {
  id: string;
  agentName?: string;
} | null;

type Props = {
  /** 从聊天工具卡点开时传入 */
  openRequest?: OpenTerminalRequest;
  onOpenConsumed?: () => void;
  defaultAgent?: string;
};

/** Short label for session chip */
function sessionChipLabel(t: TerminalInfo): string {
  const raw = t.description || t.command || t.id;
  if (raw.length <= 22) return raw;
  return `${raw.slice(0, 20)}…`;
}

function statusLabel(
  active: { id: string; agent: string } | null,
  status: string,
  list: TerminalInfo[],
): string {
  if (!active) {
    return list.length ? `${list.length} 个会话` : "空闲";
  }
  if (status) return status;
  return "已附着";
}

export function TerminalPanel({
  openRequest,
  onOpenConsumed,
  defaultAgent = "coding",
}: Props) {
  const [list, setList] = useState<TerminalInfo[]>([]);
  const [active, setActive] = useState<{ id: string; agent: string } | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeRef = useRef<{ id: string; agent: string } | null>(null);
  activeRef.current = active;

  const refreshList = useCallback(async () => {
    try {
      // 当前 agent；若为空则 all 兜底（agentName 不一致时仍能看见）
      let ts = await fetchTerminals(defaultAgent);
      if (ts.length === 0) {
        ts = await fetchTerminals(undefined, { all: true });
      }
      setList(ts.slice().reverse()); // 新的在上
    } catch {
      setList([]);
    }
  }, [defaultAgent]);

  useEffect(() => {
    void refreshList();
    const t = setInterval(() => void refreshList(), 1500);
    return () => clearInterval(t);
  }, [refreshList]);

  // 初始化 xterm（只一次）—— 配色对齐 wire 暖灰壳（--n-*）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        'var(--font-pixel-mono), "Fusion Pixel 12 Mono", ui-monospace, monospace',
      lineHeight: 1.28,
      theme: {
        // void / paper ladder from draft-shell (tau-ceti)
        background: "#1a1817",
        foreground: "#f5f0e8",
        cursor: "#c7ff20",
        cursorAccent: "#1a1817",
        selectionBackground: "rgba(199, 255, 32, 0.24)",
        selectionForeground: "#f5f0e8",
        black: "#1a1817",
        red: "#ff741d",
        green: "#3bffa7",
        yellow: "#ffd900",
        blue: "#2121ff",
        magenta: "#8363ff",
        cyan: "#c7ff20",
        white: "#f5f0e8",
        brightBlack: "#8a8278",
        brightRed: "#ff8f4a",
        brightGreen: "#6bffc0",
        brightYellow: "#ffe34d",
        brightBlue: "#5a5aff",
        brightMagenta: "#a48fff",
        brightCyan: "#d4ff4a",
        brightWhite: "#ffffff",
      },
      convertEol: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    // Keep buffer quiet until attach; CSS overlay explains idle state

    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    requestAnimationFrame(onResize);

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    return () => {
      ro.disconnect();
      wsRef.current?.close();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  /**
   * Attach to agent terminal. Re-open of the same live session is a no-op
   * (avoids xterm reset flash when chat auto-opens on every tool_result).
   * Pass force=true to hard-reconnect (list click / manual refresh).
   */
  const attach = useCallback(
    (id: string, agent: string, opts?: { force?: boolean }) => {
      const term = termRef.current;
      if (!term) return;

      const cur = activeRef.current;
      const live =
        wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING;
      if (
        !opts?.force &&
        cur?.id === id &&
        cur?.agent === agent &&
        live
      ) {
        try {
          fitRef.current?.fit();
        } catch {
          /* ignore */
        }
        term.focus();
        return;
      }

      wsRef.current?.close();
      setActive({ id, agent });
      setStatus("连接中…");
      term.reset();
      term.writeln(`\x1b[90m[webui] attach ${agent}/${id}…\x1b[0m`);

      const ws = new WebSocket(agentTerminalWsUrl(id, agent));
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type: string;
            data?: string;
            message?: string;
            state?: string;
            exitCode?: number | null;
            command?: string;
            description?: string;
            code?: number | null;
          };
          if (msg.type === "ready") {
            setStatus(msg.state || "已附着");
            if (msg.data) term.write(msg.data);
            try {
              fitRef.current?.fit();
            } catch {
              /* ignore */
            }
            term.focus();
          } else if (msg.type === "data" && msg.data) {
            term.write(msg.data);
          } else if (msg.type === "reset" && msg.data != null) {
            term.reset();
            term.write(msg.data);
          } else if (msg.type === "status") {
            setStatus(
              `${msg.state ?? ""}${msg.exitCode != null ? ` · exit ${msg.exitCode}` : ""}`,
            );
          } else if (msg.type === "exit") {
            setStatus(`已退出 ${msg.code ?? ""}`.trim());
            term.writeln(
              `\r\n\x1b[90m[webui] process ended (${msg.code ?? "?"})\x1b[0m`,
            );
          } else if (msg.type === "error") {
            setStatus("错误");
            term.writeln(
              `\r\n\x1b[31m[webui] ${msg.message ?? "error"}\x1b[0m`,
            );
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) {
          setStatus((s) => (s.startsWith("已退出") || s.startsWith("exited") ? s : "已断开"));
        }
      };
    },
    [],
  );

  // 外部 openRequest（聊天点「打开终端」）
  useEffect(() => {
    if (!openRequest?.id) return;
    const agent = openRequest.agentName || defaultAgent;
    // no force: keep live stream if already attached to this id
    attach(openRequest.id, agent);
    onOpenConsumed?.();
    void refreshList();
  }, [openRequest, attach, defaultAgent, onOpenConsumed, refreshList]);

  // 列表有会话且尚未附着：自动附着最新一条（避免打开面板仍是纯黑 idle）
  useEffect(() => {
    if (active || list.length === 0) return;
    if (!termRef.current) return;
    const top = list[0]!;
    attach(top.id, top.agentName || defaultAgent);
  }, [list, active, attach, defaultAgent]);

  const onStop = async () => {
    if (!active) return;
    await stopTerminal(active.id, active.agent);
    void refreshList();
  };

  const st = statusLabel(active, status, list);

  return (
    <div
      className="term-panel term-panel--wire"
      data-term-wire="1"
      data-term-surface="dark"
    >
      {/* 顶栏：状态 + 动作（不重复 dock 卡标题「终端」） */}
      <header className="term-toolbar" aria-label="终端工具栏">
        <div className="term-toolbar-left">
          <span
            className={`term-status-dot${active ? " is-live" : ""}`}
            aria-hidden
          />
          <span className="term-status" title={active ? active.id : undefined}>
            {active ? (
              <>
                <span className="term-status-id">{active.id}</span>
                <span className="term-status-sep">·</span>
                <span className="term-status-state">{st}</span>
              </>
            ) : (
              <span className="term-status-state">{st}</span>
            )}
          </span>
        </div>
        <div className="term-toolbar-actions">
          <button
            type="button"
            className="term-btn"
            onClick={() => void refreshList()}
          >
            刷新
          </button>
          <button
            type="button"
            className="term-btn is-danger"
            disabled={!active}
            onClick={() => void onStop()}
          >
            停止
          </button>
        </div>
      </header>

      {/* 会话条：横向 chips，省高度、对齐 wire chip 语言 */}
      <div className="term-sessions" aria-label="终端会话">
        {list.length === 0 ? (
          <p className="term-sessions-empty">
            暂无会话 · Agent 调用 <code>use_terminal</code> 后出现
          </p>
        ) : (
          <div className="term-session-row" role="tablist">
            {list.map((t) => {
              const isOn = active?.id === t.id;
              const done = t.exitCode != null || t.state === "exited";
              return (
                <button
                  key={`${t.agentName}:${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isOn}
                  className={
                    "term-session-chip" +
                    (isOn ? " is-active" : "") +
                    (done ? " is-done" : "")
                  }
                  title={[t.id, t.description || t.command, t.state]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() =>
                    attach(t.id, t.agentName || defaultAgent, { force: true })
                  }
                >
                  <span className="term-session-chip-label">
                    {sessionChipLabel(t)}
                  </span>
                  {t.state ? (
                    <span className="term-session-chip-meta">{t.state}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={`term-wrap${active ? "" : " is-idle"}`}
        ref={hostRef}
        data-term-host="xterm"
      />
    </div>
  );
}
