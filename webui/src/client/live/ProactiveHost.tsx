/**
 * 主动智能工作台：设置 · 对话 · 待办看板
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
/** Agent 层 pure 语法；loop 在服务端 ProactiveService（附属驻扎） */
import {
  PROACTIVE_ZONES,
  type ProactiveFrequency,
  type ProactiveItem,
  type ProactiveZone,
} from "@little-house-studio/agent/proactive/types";
import { isQueued } from "@little-house-studio/agent/proactive/board-format";
import { ChromeMark } from "../drafts/icons/Marks";
import {
  abortProactive,
  fetchProactive,
  patchProactiveItem,
  putProactiveSettings,
  startProactiveDispatch,
  startProactiveScan,
  streamProactiveChat,
  type ProactiveSnapshot,
} from "./proactive-api";

function jobLabel(job: ProactiveSnapshot["job"]): string {
  if (job.status === "idle") return "空闲";
  if (job.status === "scanning") return "扫描中…";
  if (job.status === "dispatching") return `派发中（${job.itemIds.length}）…`;
  if (job.status === "error") return `错误：${job.message}`;
  return "—";
}

function riskClass(risk: string): string {
  if (risk === "高" || risk.toLowerCase() === "high") return "is-high";
  if (risk === "低" || risk.toLowerCase() === "low") return "is-low";
  return "is-mid";
}

export type ProactiveHostProps = {
  /** page=旧顶栏全页；card=底栏 dock 文件夹卡片（默认推荐） */
  presentation?: "page" | "card";
};

export function ProactiveHost({ presentation = "card" }: ProactiveHostProps) {
  const [snap, setSnap] = useState<ProactiveSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchProactive();
      setSnap(s);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => {
      void load();
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [snap?.chat.length]);

  const settings = snap?.settings;
  const board = snap?.board;
  const job = snap?.job;
  const busy =
    busyAction ||
    sending ||
    job?.status === "scanning" ||
    job?.status === "dispatching";

  const openByZone = useMemo(() => {
    const map = new Map<ProactiveZone | "已完成", ProactiveItem[]>();
    for (const z of PROACTIVE_ZONES) map.set(z, []);
    map.set("已完成", []);
    for (const it of board?.items ?? []) {
      if (it.done || it.zone === "已完成") {
        map.get("已完成")!.push(it);
      } else if (map.has(it.zone as ProactiveZone)) {
        map.get(it.zone as ProactiveZone)!.push(it);
      }
    }
    return map;
  }, [board]);

  const queuedCount = useMemo(
    () => (board?.items ?? []).filter((i) => !i.done && isQueued(i)).length,
    [board],
  );

  const applySettings = async (patch: Partial<NonNullable<typeof settings>>) => {
    setBusyAction(true);
    try {
      const s = await putProactiveSettings(patch);
      setSnap(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(false);
    }
  };

  const onScan = async (autoDispatch = false) => {
    setBusyAction(true);
    try {
      const s = await startProactiveScan({ autoDispatch });
      setSnap(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(false);
    }
  };

  const onDispatchQueued = async () => {
    setBusyAction(true);
    try {
      const s = await startProactiveDispatch({ queuedOnly: true });
      setSnap(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(false);
    }
  };

  const onAbort = async () => {
    try {
      const s = await abortProactive();
      setSnap(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onToggleQueue = async (id: string, queue: boolean) => {
    try {
      const r = await patchProactiveItem(id, { queue });
      setSnap((prev) => (prev ? { ...prev, board: r.board } : prev));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onToggleDone = async (id: string, done: boolean) => {
    try {
      const r = await patchProactiveItem(id, { done });
      setSnap((prev) => (prev ? { ...prev, board: r.board } : prev));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onSend = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setSending(true);
    setInput("");
    try {
      for await (const _ev of streamProactiveChat(msg)) {
        /* stream events; final state via poll */
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const toggleAutoZone = (z: ProactiveZone) => {
    if (!settings) return;
    const has = settings.autoZones.includes(z);
    const autoZones = has
      ? settings.autoZones.filter((x) => x !== z)
      : [...settings.autoZones, z];
    void applySettings({ autoZones });
  };

  return (
    <section
      className={`proactive-host${presentation === "card" ? " is-card" : ""}`}
      data-live-proactive="true"
      data-proactive-presentation={presentation}
      aria-label="主动智能"
    >
      <header className="proactive-bar">
        <div className="proactive-bar-left">
          <ChromeMark kind="tasks" size={16} decorative />
          <strong>主动智能</strong>
          <span className="proactive-meta" title="挂靠主 coding，非可切换主体">
            附属驻扎 · parent coding
          </span>
          <span className="proactive-job" data-status={job?.status ?? "idle"}>
            {job ? jobLabel(job) : "加载中…"}
          </span>
          {settings ? (
            <span className="proactive-meta">
              今日 {settings.runsToday}/{settings.maxRunsPerDay}
              {settings.lastScanAt
                ? ` · 上次扫描 ${settings.lastScanAt.slice(11, 16)}`
                : ""}
            </span>
          ) : null}
        </div>
        <div className="proactive-bar-actions">
          <button
            type="button"
            className="wire-text-btn"
            disabled={busy}
            onClick={() => void onScan(false)}
          >
            立即扫描
          </button>
          <button
            type="button"
            className="wire-text-btn"
            disabled={busy || queuedCount === 0}
            onClick={() => void onDispatchQueued()}
            title="对已勾选条目派发主 coding agent"
          >
            确认执行{queuedCount ? ` (${queuedCount})` : ""}
          </button>
          <button
            type="button"
            className="wire-text-btn"
            disabled={!busy}
            onClick={() => void onAbort()}
          >
            中止
          </button>
        </div>
      </header>

      {err ? (
        <div className="proactive-error" role="alert">
          {err}
        </div>
      ) : null}

      <div className="proactive-body">
        {/* 设置 */}
        <aside className="proactive-settings" aria-label="主动智能设置">
          <h3 className="proactive-section-title">设置</h3>
          {!settings ? (
            <p className="proactive-hint">加载设置…</p>
          ) : (
            <>
              <label className="proactive-field">
                <span>启用</span>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) =>
                    void applySettings({ enabled: e.target.checked })
                  }
                />
              </label>
              <label className="proactive-field">
                <span>频率</span>
                <select
                  value={settings.frequency}
                  onChange={(e) =>
                    void applySettings({
                      frequency: e.target.value as ProactiveFrequency,
                    })
                  }
                >
                  <option value="off">关闭自动</option>
                  <option value="after_edit">编辑后扫描</option>
                  <option value="interval">定时扫描</option>
                </select>
              </label>
              {settings.frequency === "interval" ? (
                <label className="proactive-field">
                  <span>间隔（分钟）</span>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={settings.intervalMinutes}
                    onChange={(e) =>
                      void applySettings({
                        intervalMinutes: Number(e.target.value) || 30,
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="proactive-field">
                <span>每日上限</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={settings.maxRunsPerDay}
                  onChange={(e) =>
                    void applySettings({
                      maxRunsPerDay: Number(e.target.value) || 20,
                    })
                  }
                />
              </label>
              <div className="proactive-auto-zones">
                <span className="proactive-field-label">自动执行分区</span>
                <p className="proactive-hint">
                  扫描后自动勾选并（在启用时）派发；默认仅安全区。
                </p>
                {PROACTIVE_ZONES.map((z) => (
                  <label key={z} className="proactive-check">
                    <input
                      type="checkbox"
                      checked={settings.autoZones.includes(z)}
                      onChange={() => toggleAutoZone(z)}
                    />
                    <span>{z}</span>
                  </label>
                ))}
              </div>
              <p className="proactive-path" title={snap?.projectRoot}>
                看板：.maou/project/PROACTIVE.md
              </p>
            </>
          )}
        </aside>

        {/* 对话 */}
        <div className="proactive-chat" aria-label="主动智能对话">
          <h3 className="proactive-section-title">对话</h3>
          <div className="proactive-chat-log">
            {(snap?.chat ?? []).map((line) => (
              <div
                key={line.id}
                className={`proactive-line role-${line.role}`}
              >
                <span className="proactive-line-role">
                  {line.role === "user"
                    ? "你"
                    : line.role === "assistant"
                      ? "主动"
                      : "系统"}
                </span>
                <pre className="proactive-line-text">{line.text}</pre>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="proactive-composer">
            <input
              type="text"
              value={input}
              placeholder="向主动 agent 提问，或描述想扫描的方向…"
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
            />
            <button
              type="button"
              className="wire-text-btn on"
              disabled={sending || !input.trim()}
              onClick={() => void onSend()}
            >
              发送
            </button>
          </div>
        </div>

        {/* 待办看板 */}
        <div className="proactive-board" aria-label="待办看板">
          <h3 className="proactive-section-title">
            待办看板
            <span className="proactive-board-hint">
              勾选后点「确认执行」派发给主 agent
            </span>
          </h3>
          <div className="proactive-zones">
            {PROACTIVE_ZONES.map((z) => {
              const items = openByZone.get(z) ?? [];
              return (
                <div key={z} className="proactive-zone">
                  <h4 className="proactive-zone-title">{z}</h4>
                  {items.length === 0 ? (
                    <p className="proactive-empty">暂无条目</p>
                  ) : (
                    <ul className="proactive-items">
                      {items.map((it) => (
                        <li key={it.id} className="proactive-item">
                          <label className="proactive-item-check">
                            <input
                              type="checkbox"
                              checked={isQueued(it)}
                              onChange={(e) =>
                                void onToggleQueue(it.id, e.target.checked)
                              }
                            />
                          </label>
                          <div className="proactive-item-body">
                            <div className="proactive-item-title-row">
                              <span className="proactive-item-title">
                                {it.title}
                              </span>
                              <span
                                className={`proactive-risk ${riskClass(String(it.risk))}`}
                              >
                                {it.risk}
                              </span>
                            </div>
                            {it.comment ? (
                              <p className="proactive-item-comment">
                                {it.comment}
                              </p>
                            ) : null}
                            <button
                              type="button"
                              className="proactive-done-btn"
                              onClick={() => void onToggleDone(it.id, true)}
                            >
                              标记完成
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            <div className="proactive-zone is-done">
              <h4 className="proactive-zone-title">已完成</h4>
              {(openByZone.get("已完成") ?? []).length === 0 ? (
                <p className="proactive-empty">暂无</p>
              ) : (
                <ul className="proactive-items">
                  {(openByZone.get("已完成") ?? []).map((it) => (
                    <li key={it.id} className="proactive-item is-done">
                      <div className="proactive-item-body">
                        <span className="proactive-item-title">{it.title}</span>
                        <button
                          type="button"
                          className="proactive-done-btn"
                          onClick={() => void onToggleDone(it.id, false)}
                        >
                          重开
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
