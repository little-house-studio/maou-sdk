import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatPorts } from "./ports/types";
import type { ChatQueuePatch, ChatSendMode } from "./api";
import { reconcileQueue, type OutboxItem } from "./chat-queue";

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const storageKey = (scope: string) => `maou.queue.drafts:${scope}`;
function restore(scope: string): OutboxItem[] {
  try {
    const items: unknown = JSON.parse(sessionStorage.getItem(storageKey(scope)) ?? "[]");
    return Array.isArray(items) ? items.filter((o): o is OutboxItem => o && typeof o.localId === "string" && typeof o.text === "string" && o.status === "failed" && (o.mode === "queue" || o.mode === "insert")).map(o => ({ ...o, locked: false })) : [];
  } catch { return []; }
}

/** Session-scoped queue, serialized mutations, authoritative snapshots and optimistic drafts. */
export function useChatQueue(sessionId: string | null | undefined, scope: string, ports: ChatPorts, report: (message: string) => void) {
  const [items, render] = useState<OutboxItem[]>(() => restore(scope));
  const ref = useRef(items);
  const actions = useRef(new Set<string>());
  const [syncError, setSyncError] = useState("");
  const [serverBusy, setServerBusy] = useState(false);
  const [capacity, setCapacity] = useState(64);
  const [pending, setPending] = useState(false);
  const context = useRef({ sessionId, scope, epoch: 0 });
  const consumed = useRef(new Set<number>());
  const consumedRequests = useRef(new Set<string>());
  const serial = useRef(Promise.resolve());
  const revision = useRef(0);
  const pollSequence = useRef(0);
  const portsRef = useRef(ports); portsRef.current = ports;
  const reportRef = useRef(report); reportRef.current = report;
  if (context.current.scope !== scope || context.current.sessionId !== sessionId) {
    context.current = { sessionId, scope, epoch: context.current.epoch + 1 };
    ref.current = restore(scope);
    consumed.current = new Set(); consumedRequests.current = new Set();
    revision.current++;
  }
  const setItems = useCallback((next: OutboxItem[] | ((previous: OutboxItem[]) => OutboxItem[])) => {
    ref.current = typeof next === "function" ? next(ref.current) : next;
    render(ref.current);
    try {
      sessionStorage.setItem(storageKey(context.current.scope), JSON.stringify(ref.current.filter(o => o.status !== "queued").map(o => ({ ...o, status: "failed", locked: false, error: o.error ?? "入队确认中断，请同步或重试" }))));
    } catch { /* drafts still available in memory */ }
  }, []);
  const refresh = useCallback(async () => {
    const ctx = context.current;
    if (!ctx.sessionId || actions.current.size) return;
    const version = revision.current;
    const sequence = ++pollSequence.current;
    try {
      const snapshot = await portsRef.current.fetchChatQueue(ctx.sessionId);
      if (context.current !== ctx || revision.current !== version || sequence !== pollSequence.current || actions.current.size) return;
      if (snapshot.sessionId !== ctx.sessionId) return;
      setItems(previous => reconcileQueue(previous, snapshot.queue, consumed.current));
      setServerBusy(snapshot.busy); setCapacity(snapshot.capacity); setSyncError("");
    } catch (e) {
      if (context.current === ctx && revision.current === version && sequence === pollSequence.current) setSyncError(`队列同步失败：${errorText(e)}`);
    }
  }, [setItems]);
  useEffect(() => {
    render(ref.current); setSyncError(""); setServerBusy(false);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await refresh();
      if (!disposed) timer = setTimeout(() => void tick(), 1500);
    };
    void tick();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener("focus", focus); };
  }, [sessionId, scope, refresh]);

  const transact = useCallback((key: string, work: (sid: string, current: () => boolean) => Promise<void>) => {
    const ctx = context.current;
    if (!ctx.sessionId || actions.current.has(key)) return Promise.resolve(false);
    actions.current.add(key); revision.current++; setPending(true);
    setItems(previous => previous.map(o => o.localId === key ? { ...o, locked: true, error: undefined } : o));
    const task = serial.current.then(async () => {
      const current = () => context.current === ctx;
      if (!current()) return false;
      try { await work(ctx.sessionId!, current); return true; }
      catch (e) {
        if (current()) {
          const error = errorText(e);
          setItems(previous => previous.map(o => o.localId === key ? { ...o, status: o.status === "sending" ? "failed" : o.status, error } : o));
          reportRef.current(error);
        }
        return false;
      }
    }).finally(() => {
      actions.current.delete(key); revision.current++;
      if (context.current === ctx) setItems(previous => previous.map(o => o.localId === key ? { ...o, locked: false } : o));
      setPending(actions.current.size > 0);
      void refresh();
    });
    serial.current = task.then(() => {});
    return task;
  }, [setItems, refresh]);

  const enqueue = useCallback((text: string, mode: ChatSendMode, retry?: OutboxItem) => {
    if (!text.trim()) return Promise.resolve(false);
    const localId = retry?.localId ?? crypto.randomUUID();
    if (actions.current.has(localId) || actions.current.has("clear")) return Promise.resolve(false);
    if (!context.current.sessionId) { reportRef.current("会话正在创建，请稍后发送"); return Promise.resolve(false); }
    const draft: OutboxItem = { localId, text, mode, status: "sending", locked: true };
    setItems(previous => retry ? previous.map(o => o.localId === localId ? draft : o) : [...previous, draft]);
    return transact(localId, async (sid, current) => {
      const result = await portsRef.current.enqueueChat(text, mode, { sessionId: sid, requestId: localId });
      if (!current()) return;
      // The stream may acknowledge consumption before this HTTP response arrives.
      setItems(previous => reconcileQueue(previous.filter(o => o.localId !== localId), result.queue, consumed.current).filter(o => !consumedRequests.current.has(o.localId)));
      setServerBusy(result.busy); setCapacity(result.capacity);
      const waiting = result.queue.some(item => item.id === result.id) && !consumed.current.has(result.id);
      reportRef.current(waiting ? (mode === "insert" ? "已请求插入当前回复" : "已排队，本轮结束后处理") : "消息已开始处理或已移除");
    });
  }, [setItems, transact]);

  const remove = useCallback((item: OutboxItem) => transact(item.localId, async (sid, current) => {
    try {
      let id = item.queueId;
      if (id == null) id = (await portsRef.current.fetchChatQueue(sid)).queue.find(o => o.requestId === item.localId)?.id;
      if (id != null) await portsRef.current.removeChatQueueItem(id, sid);
    } catch (e) { throw new Error(`移除失败：${errorText(e)}`); }
    if (current()) setItems(previous => previous.filter(o => o.localId !== item.localId));
  }), [transact, setItems]);
  const clear = useCallback(() => {
    if (actions.current.size) return Promise.resolve(false);
    const ids = ref.current.filter(o => o.status === "queued" && o.queueId != null).map(o => o.queueId!);
    return transact("clear", async (sid, current) => {
      try { await portsRef.current.clearChatQueue(sid, ids); } catch (e) { throw new Error(`清空失败：${errorText(e)}`); }
      if (current()) { setItems(previous => previous.filter(o => o.queueId == null || !ids.includes(o.queueId))); reportRef.current("已清空排队，失败草稿已保留"); }
    });
  }, [transact, setItems]);
  const update = useCallback((item: OutboxItem, patch: ChatQueuePatch) => transact(item.localId, async (sid, current) => {
    if (item.queueId == null) {
      if (current() && patch.message?.trim()) setItems(previous => previous.map(o => o.localId === item.localId ? { ...o, localId: crypto.randomUUID(), text: patch.message!.trim(), locked: false, error: undefined } : o));
      return;
    }
    const result = await portsRef.current.updateChatQueueItem(item.queueId, patch, sid);
    if (!current()) return;
    setItems(previous => reconcileQueue(previous, result.queue, consumed.current));
    if (!result.updated) reportRef.current("该消息已开始处理，无法修改");
  }), [transact, setItems]);
  const consume = useCallback((id: number, requestId?: string) => {
    if (Number.isSafeInteger(id)) consumed.current.add(id);
    if (requestId) consumedRequests.current.add(requestId);
    revision.current++;
    setItems(previous => previous.filter(o => o.queueId !== id && (!requestId || o.localId !== requestId)));
  }, [setItems]);
  return { items: ref.current, setItems, ref, actions, pending, capacity, serverBusy, syncError, refresh, enqueue, remove, clear, update, consume };
}
