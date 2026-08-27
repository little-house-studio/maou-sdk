import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
/** 懒加载 chunk 自带 wire 样式，不依赖外层 CSS 是否已热更 */
import "./terminal-wire.css";
import { useAppPorts } from "./ports";
import type { TerminalCapabilities, TerminalInfo } from "./api";

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

const FONT_KEY = "maou.app.term.fontSize";

function readFontSize(): number {
  const n = Number(localStorage.getItem(FONT_KEY));
  return Number.isFinite(n) && n >= 10 && n <= 22 ? n : 12;
}

function isHumanId(id: string, kind?: string): boolean {
  return kind === "human" || id.startsWith("human_");
}

function shellQuotePath(p: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** Short label for session chip */
function sessionChipLabel(t: TerminalInfo): string {
  const raw = t.description || t.command || t.id;
  if (raw.length <= 22) return raw;
  return `${raw.slice(0, 20)}…`;
}

function statusLabel(
  active: { id: string; agent: string; kind?: string } | null,
  status: string,
  list: TerminalInfo[],
): string {
  if (!active) {
    return list.length ? `${list.length} 个会话` : "空闲";
  }
  if (status) return status;
  return isHumanId(active.id, active.kind) ? "人壳" : "Agent 会话";
}

type Active = { id: string; agent: string; kind?: "agent" | "human"; cwd?: string };

export function TerminalPanel({
  openRequest,
  onOpenConsumed,
  defaultAgent = "coding",
}: Props) {
  const {
    agentTerminalWsUrl,
    fetchTerminalCapabilities,
    fetchTerminals,
    humanTerminalWsUrl,
    stopTerminal,
  } = useAppPorts().terminals;
  const [list, setList] = useState<TerminalInfo[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [status, setStatus] = useState("");
  const [caps, setCaps] = useState<TerminalCapabilities | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [fontSize, setFontSize] = useState(readFontSize);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const hbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressReconnect = useRef(false);
  const activeRef = useRef<Active | null>(null);
  const listRef = useRef(list);
  activeRef.current = active;
  listRef.current = list;

  const refreshList = useCallback(async () => {
    try {
      const ts = await fetchTerminals(undefined, { all: true });
      setList(ts.slice().reverse());
    } catch {
      setList([]);
    }
  }, []);

  useEffect(() => {
    void refreshList();
    const t = setInterval(() => void refreshList(), 1500);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    void fetchTerminalCapabilities()
      .then(setCaps)
      .catch(() =>
        setCaps({
          humanShell: false,
          kind: "mini",
          degraded: true,
          reason: "无法读取终端能力",
        }),
      );
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.fontSize = fontSize;
    try {
      localStorage.setItem(FONT_KEY, String(fontSize));
    } catch {
      /* ignore */
    }
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
  }, [fontSize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: readFontSize(),
      fontFamily:
        'var(--font-pixel-mono), "Fusion Pixel 12 Mono", ui-monospace, monospace',
      lineHeight: 1.28,
      scrollback: 10000,
      macOptionIsMeta: true,
      theme: {
        background: "#0b0b0b",
        foreground: "#c7ff20",
        cursor: "#c7ff20",
        cursorAccent: "#0b0b0b",
        selectionBackground: "rgba(199, 255, 32, 0.24)",
        selectionForeground: "#c7ff20",
        black: "#0b0b0b",
        red: "#ff5a2e",
        green: "#c7ff20",
        yellow: "#ffb020",
        blue: "#8b7ec8",
        magenta: "#8b7ec8",
        cyan: "#c7ff20",
        white: "#ecece8",
        brightBlack: "#8a8a84",
        brightRed: "#ff8f4a",
        brightGreen: "#d4ff4a",
        brightYellow: "#ffd06a",
        brightBlue: "#a79be0",
        brightMagenta: "#a79be0",
        brightCyan: "#d4ff4a",
        brightWhite: "#ffffff",
      },
      convertEol: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;
      const meta = ev.metaKey || ev.ctrlKey;
      if (!meta) return true;
      const k = ev.key.toLowerCase();
      if (ev.shiftKey && (k === "c" || k === "v")) return true;
      if (k === "c" && term.hasSelection()) {
        const sel = term.getSelection();
        if (sel) void navigator.clipboard.writeText(sel).catch(() => {});
        return false;
      }
      if (k === "v") return true;
      if (k === "w" || k === "t" || k === "n" || k === "l") {
        ev.preventDefault();
        return false;
      }
      return true;
    });

    const onResize = () => {
      try {
        fit.fit();
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
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

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      const parts: string[] = [];
      for (const f of files) {
        const p = (f as File & { path?: string }).path || f.name;
        parts.push(shellQuotePath(p));
      }
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: parts.join(" ") }));
      }
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    host.addEventListener("drop", onDrop);
    host.addEventListener("dragover", onDragOver);

    return () => {
      ro.disconnect();
      host.removeEventListener("drop", onDrop);
      host.removeEventListener("dragover", onDragOver);
      if (hbRef.current) clearInterval(hbRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const startHeartbeat = (ws: WebSocket) => {
    if (hbRef.current) clearInterval(hbRef.current);
    hbRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);
  };

  const wireCommon = (
    ws: WebSocket,
    term: Terminal,
    onReady?: (msg: { id?: string; cwd?: string; state?: string; agentName?: string }) => void,
  ) => {
    startHeartbeat(ws);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type: string;
          data?: string;
          message?: string;
          state?: string;
          exitCode?: number | null;
          code?: number | null;
          id?: string;
          cwd?: string;
          agentName?: string;
        };
        if (msg.type === "pong") return;
        if (msg.type === "ready") {
          onReady?.(msg);
          if (msg.data) term.write(msg.data);
          try {
            fitRef.current?.fit();
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
            }
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
          suppressReconnect.current = true;
          setStatus(`已退出 ${msg.code ?? ""}`.trim());
          term.writeln(`\r\n\x1b[90m[app] process ended (${msg.code ?? "?"})\x1b[0m`);
        } else if (msg.type === "error") {
          setStatus("错误");
          term.writeln(`\r\n\x1b[31m[app] ${msg.message ?? "error"}\x1b[0m`);
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (hbRef.current) clearInterval(hbRef.current);
      if (wsRef.current !== ws) return;
      setStatus((s) => (s.startsWith("已退出") || s.startsWith("exited") ? s : "已断开"));
      const cur = activeRef.current;
      if (!suppressReconnect.current && cur) {
        reconnectRef.current = setTimeout(() => {
          if (isHumanId(cur.id, cur.kind)) {
            connectHuman({ mode: "attach", id: cur.id, silent: true });
          } else {
            attach(cur.id, cur.agent, { force: true, silent: true });
          }
        }, 800);
      }
    };
  };

  const connectHuman = useCallback(
    (opts: { mode: "create" | "attach"; id?: string; silent?: boolean; cwd?: string }) => {
      const term = termRef.current;
      if (!term) return;
      if (caps && !caps.humanShell) {
        setStatus("人壳不可用");
        term.writeln(
          `\x1b[31m[app] ${caps.reason ?? "人壳需要 Rust terminal-engine .node"}\x1b[0m`,
        );
        return;
      }
      suppressReconnect.current = false;
      wsRef.current?.close();
      if (!opts.silent) {
        setStatus(opts.mode === "create" ? "新开壳…" : "重连人壳…");
        term.reset();
        term.writeln(
          `\x1b[90m[app] ${opts.mode === "create" ? "open" : "attach"} human shell…\x1b[0m`,
        );
      }
      const ws = new WebSocket(humanTerminalWsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        try {
          fitRef.current?.fit();
        } catch {
          /* ignore */
        }
        if (opts.mode === "attach" && opts.id) {
          ws.send(
            JSON.stringify({
              type: "attach",
              id: opts.id,
              cols: term.cols,
              rows: term.rows,
            }),
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "create",
              cols: term.cols,
              rows: term.rows,
              cwd: opts.cwd,
            }),
          );
        }
      };
      wireCommon(ws, term, (msg) => {
        if (msg.id) {
          setActive({
            id: msg.id,
            agent: msg.agentName || defaultAgent,
            kind: "human",
            cwd: msg.cwd,
          });
        }
        setStatus("人壳");
      });
      void refreshList();
    },
    [caps, defaultAgent, refreshList],
  );

  const attach = useCallback(
    (id: string, agent: string, opts?: { force?: boolean; silent?: boolean }) => {
      const term = termRef.current;
      if (!term) return;

      if (isHumanId(id)) {
        connectHuman({ mode: "attach", id, silent: opts?.silent });
        return;
      }

      const cur = activeRef.current;
      const live =
        wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING;
      if (!opts?.force && cur?.id === id && cur?.agent === agent && live) {
        try {
          fitRef.current?.fit();
        } catch {
          /* ignore */
        }
        term.focus();
        return;
      }

      suppressReconnect.current = false;
      wsRef.current?.close();
      const info = listRef.current.find((t) => t.id === id);
      setActive({ id, agent, kind: "agent", cwd: info?.cwd });
      if (!opts?.silent) {
        setStatus("连接中…");
        term.reset();
        term.writeln(`\x1b[90m[app] attach ${agent}/${id}…\x1b[0m`);
      }

      const ws = new WebSocket(agentTerminalWsUrl(id, agent));
      wsRef.current = ws;
      wireCommon(ws, term, (msg) => {
        setStatus(msg.state || "Agent 会话");
      });
    },
    [connectHuman],
  );

  const openHumanShell = useCallback(() => {
    connectHuman({ mode: "create" });
  }, [connectHuman]);

  useEffect(() => {
    if (!openRequest?.id) return;
    const agent = openRequest.agentName || defaultAgent;
    attach(openRequest.id, agent);
    onOpenConsumed?.();
    void refreshList();
  }, [openRequest, attach, defaultAgent, onOpenConsumed, refreshList]);

  useEffect(() => {
    if (active || list.length === 0) return;
    if (!termRef.current) return;
    const top = list[0]!;
    attach(top.id, top.agentName || defaultAgent);
  }, [list, active, attach, defaultAgent]);

  const onStop = async () => {
    if (!active) return;
    suppressReconnect.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    await stopTerminal(active.id, active.agent);
    void refreshList();
  };

  const onRestart = () => {
    if (!active || !isHumanId(active.id, active.kind)) {
      openHumanShell();
      return;
    }
    suppressReconnect.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    const cwd = active.cwd;
    void stopTerminal(active.id, active.agent).finally(() => {
      connectHuman({ mode: "create", cwd });
    });
  };

  const info = active ? list.find((t) => t.id === active.id) : undefined;
  const st = statusLabel(active, status, list);
  const kindLabel = active
    ? isHumanId(active.id, active.kind)
      ? "人"
      : "Agent 会话"
    : "";

  return (
    <div
      className="term-panel term-panel--wire"
      data-term-wire="1"
      data-term-surface="dark"
    >
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
                <span className="term-status-state">
                  {kindLabel}
                  {kindLabel ? " · " : ""}
                  {st}
                  {info?.cwd || active.cwd
                    ? ` · ${info?.cwd || active.cwd}`
                    : ""}
                  {info?.exitCode != null ? ` · exit ${info.exitCode}` : ""}
                </span>
              </>
            ) : (
              <span className="term-status-state">{st}</span>
            )}
          </span>
        </div>
        <div className="term-toolbar-actions">
          <input
            className="term-search"
            type="search"
            placeholder="搜索"
            value={searchQ}
            onChange={(e) => {
              const q = e.target.value;
              setSearchQ(q);
              if (q) searchRef.current?.findNext(q);
              else searchRef.current?.clearDecorations();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (searchQ) searchRef.current?.findNext(searchQ);
              }
            }}
          />
          <button type="button" className="term-btn" title="字号减" onClick={() => setFontSize((n) => Math.max(10, n - 1))}>
            A-
          </button>
          <button type="button" className="term-btn" title="字号加" onClick={() => setFontSize((n) => Math.min(22, n + 1))}>
            A+
          </button>
          <button
            type="button"
            className="term-btn"
            title="清屏（不杀进程）"
            onClick={() => termRef.current?.clear()}
          >
            清屏
          </button>
          <button
            type="button"
            className="term-btn"
            disabled={caps != null && !caps.humanShell}
            title={
              caps && !caps.humanShell
                ? caps.reason ?? "人壳需要 Rust .node"
                : "新开一个交互 shell"
            }
            onClick={() => openHumanShell()}
          >
            新开壳
          </button>
          <button
            type="button"
            className="term-btn"
            title="同目录重启人壳"
            disabled={caps != null && !caps.humanShell}
            onClick={() => onRestart()}
          >
            重启壳
          </button>
          <button type="button" className="term-btn" onClick={() => void refreshList()}>
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

      <div className="term-sessions" aria-label="终端会话">
        {list.length === 0 ? (
          <p className="term-sessions-empty">
            暂无会话 · Agent 调用 <code>use_terminal</code> 或点「新开壳」
          </p>
        ) : (
          <div className="term-session-row" role="tablist">
            {list.map((t) => {
              const isOn = active?.id === t.id;
              const done = t.exitCode != null || t.state === "exited";
              const human = isHumanId(t.id, t.kind);
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
                  title={[human ? "人" : "Agent", t.id, t.cwd, t.description || t.command, t.state]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() =>
                    attach(t.id, t.agentName || defaultAgent, { force: true })
                  }
                >
                  <span className="term-session-chip-label">
                    {(human ? "人 · " : "Agent · ") + sessionChipLabel(t)}
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
