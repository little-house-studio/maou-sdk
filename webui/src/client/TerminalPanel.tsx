import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
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

  // 初始化 xterm（只一次）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      theme: {
        background: "#000000",
        foreground: "#e8e6e0",
        cursor: "#c7ff20",
        selectionBackground: "#3a3a20",
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    term.writeln(
      "\x1b[90m[webui] 选择左侧 Agent 终端，或点击聊天里的 use_terminal 打开\x1b[0m",
    );

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

  const attach = useCallback((id: string, agent: string) => {
    const term = termRef.current;
    if (!term) return;

    wsRef.current?.close();
    setActive({ id, agent });
    setStatus("connecting…");
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
          setStatus(msg.state || "attached");
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
            `${msg.state ?? ""}${msg.exitCode != null ? ` exit=${msg.exitCode}` : ""}`,
          );
        } else if (msg.type === "exit") {
          setStatus(`exited ${msg.code ?? ""}`);
          term.writeln(
            `\r\n\x1b[90m[webui] process ended (${msg.code ?? "?"})\x1b[0m`,
          );
        } else if (msg.type === "error") {
          setStatus("error");
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
        setStatus((s) => (s.startsWith("exited") ? s : "disconnected"));
      }
    };
  }, []);

  // 外部 openRequest（聊天点击）
  useEffect(() => {
    if (!openRequest?.id) return;
    const agent = openRequest.agentName || defaultAgent;
    attach(openRequest.id, agent);
    onOpenConsumed?.();
    void refreshList();
  }, [openRequest, attach, defaultAgent, onOpenConsumed, refreshList]);

  const onStop = async () => {
    if (!active) return;
    await stopTerminal(active.id, active.agent);
    void refreshList();
  };

  return (
    <div className="panel term-panel">
      <div className="panel-header">
        Agent terminals
        {active ? (
          <span className="term-active-label">
            {" "}
            · {active.id}
            {status ? ` · ${status}` : ""}
          </span>
        ) : null}
      </div>
      <div className="term-body">
        <div className="term-list">
          <div className="term-list-head">
            <button type="button" className="linkish" onClick={() => void refreshList()}>
              刷新
            </button>
            {active ? (
              <button type="button" className="linkish danger" onClick={() => void onStop()}>
                停止
              </button>
            ) : null}
          </div>
          {list.length === 0 ? (
            <div className="term-empty">
              暂无会话。Agent 调用 use_terminal 后会出现在这里。
            </div>
          ) : (
            list.map((t) => (
              <button
                key={`${t.agentName}:${t.id}`}
                type="button"
                className={
                  "term-item" +
                  (active?.id === t.id ? " active" : "") +
                  (t.exitCode != null || t.state === "exited" ? " done" : "")
                }
                onClick={() => attach(t.id, t.agentName || defaultAgent)}
                title={t.command}
              >
                <div className="term-item-id">{t.id}</div>
                <div className="term-item-desc">
                  {t.description || t.command || t.state}
                </div>
                <div className="term-item-meta">
                  {t.state}
                  {t.exitCode != null ? ` · ${t.exitCode}` : ""}
                </div>
              </button>
            ))
          )}
        </div>
        <div className="term-wrap" ref={hostRef} />
      </div>
    </div>
  );
}
