import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useChatQueue } from "../../src/client/use-chat-queue";
import { QueueDock } from "../../src/client/composer/QueueDock";
import type { QueuedChatItem } from "../../src/client/api";
import { ComposerBar } from "../../src/client/composer/ComposerBar";
import type { ComposerProps } from "../../src/client/composer/types";
import { PortsProvider, createLivePorts } from "../../src/client/ports";
import { ModelCascadeMenu } from "../../src/client/wire/menus/ModelCascadeMenu";
import { ProjectWorkbench } from "../../src/client/wire/project/ProjectWorkbench";
import { ChatPanel } from "../../src/client/ChatPanel";
import { ApprovalBanner } from "../../src/client/wire/thread/ApprovalBanner";
import { SessionUsageModal } from "../../src/client/SessionUsageModal";
import { LiveProjectHost } from "../../src/client/live/LiveProjectHost";
import { TerminalPanel } from "../../src/client/TerminalPanel";
import { PluginsPanel } from "../../src/client/wire/plugins/PluginsPanel";
import { ProactiveHost } from "../../src/client/live/ProactiveHost";
import { FolderBrowse } from "../../src/client/live/FolderBrowse";
import { LiveApp } from "../../src/client/host/LiveApp";
import { createLiveHostSlots } from "../../src/client/host/live-slots";
import { SlotsProvider } from "../../src/client/slots";
import { useLiveHostBag } from "../../src/client/host/live-state";
import "../../src/client/styles.css";
import "../../src/client/wire/wire.css";
import "../../src/client/composer/composer.css";
import "../../src/client/live-shell.css";

const calls: Array<{ name: string; args: unknown[] }> = [];
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
function record(name: string, ...args: unknown[]) { calls.push({ name, args }); }
function defer(name: string) {
  record(name);
  return new Promise<any>((resolve, reject) => pending.set(name, { resolve, reject }));
}
const audit = {
  calls,
  resolve: (name: string, value: unknown) => pending.get(name)?.resolve(value),
  reject: (name: string) => pending.get(name)?.reject(new Error(`test failure: ${name}`)),
};
(window as any).audit = audit;
const meta = { sessionId: "s1", provider: "a", model: "a1", projectRoot: "/test", sandboxMode: "normal", approvalMode: "normal", agentName: "coding" };
const models = [{ id: "a1" }];
const providers = [{ id: "a" }, { id: "b" }, { id: "c" }];
const ports = createLivePorts();
let queueItems: QueuedChatItem[] = [];
let queueSeq = 0;
let queueBusy = false;
const accepted = new Map<string, number>();
const snapshot = () => ({ sessionId: meta.sessionId, busy: queueBusy, capacity: 64, queue: queueItems.map(o => ({ ...o })) });
Object.assign(audit, {
  setQueue: (messages: string[], busy = false) => { queueItems = messages.map(message => ({ id: ++queueSeq, message, mode: "after_round_complete", source: "app", enqueuedAt: Date.now() })); queueBusy = busy; },
  queue: () => snapshot(),
  holdEnqueue: false,
  rejectEnqueue: false,
  consume: (_id: number) => {},
});
Object.assign(ports.chat, {
  fetchMeta: async () => meta,
  fetchSessions: async () => ({ sessions: [{ id: "s1", title: "First", messageCount: 0, userTurns: 0 }, { id: "s2", title: "Second", messageCount: 0, userTurns: 0 }], activeId: "s1", runningSessionIds: [] }),
  fetchSessionMessages: async () => ({ messages: [], oldestSeq: null, hasMore: false }),
  fetchModels: async () => ({ meta, models, providers }),
  fetchLlmConfig: async () => ({ presets: [] }),
  fetchSessionStats: async () => ({}),
  fetchApproval: async () => ({ mode: "normal", pending: [] }),
  fetchPendingAsk: async () => [],
  fetchSessionPlan: async () => ({ markdown: "" }),
  fetchCommandCatalog: async () => ({ commands: [] }),
  searchSessions: async () => ({ hits: [] }),
  fetchChatQueue: async () => snapshot(),
  streamChat: async function* (_text: string, signal?: AbortSignal, _images?: unknown, options?: { resumeQueue?: boolean }) {
    record("send", options); queueBusy = true;
    if (options?.resumeQueue) {
      const first = queueItems.shift();
      if (first) yield { type: "queued_user", id: first.id, requestId: first.requestId, content: first.message };
    }
    await Promise.race([defer("stream"), new Promise(resolve => signal?.addEventListener("abort", resolve, { once: true }))]);
    queueBusy = false;
    yield { type: "done" };
  },
  abortChat: async (...args: unknown[]) => { record("abortArgs", ...args); await defer("abort"); queueBusy = false; },
  enqueueChat: async (message: string, mode: string, options: { requestId: string }) => {
    record("enqueue", message, mode, options);
    if ((audit as any).rejectEnqueue) throw new Error("队列暂不可用，请重试");
    let id = accepted.get(options.requestId);
    if (!id) {
      id = ++queueSeq; accepted.set(options.requestId, id);
      queueItems.push({ id, message, mode: mode === "insert" ? "interrupt_immediately" : "after_round_complete", requestId: options.requestId, source: "app", enqueuedAt: Date.now() });
    }
    if ((audit as any).holdEnqueue) await defer("enqueueAck");
    return { id, ...snapshot() };
  },
  updateChatQueueItem: async (id: number, patch: { message?: string; mode?: string; move?: string }) => {
    record("updateQueue", id, patch);
    const index = queueItems.findIndex(o => o.id === id);
    if (index >= 0) {
      const item = queueItems[index]!;
      if (patch.message !== undefined) item.message = patch.message;
      if (patch.mode) item.mode = patch.mode === "insert" ? "interrupt_immediately" : "after_round_complete";
      if (patch.move) { queueItems.splice(index, 1); queueItems.splice(Math.max(0, Math.min(queueItems.length, index + (patch.move === "up" ? -1 : 1))), 0, item); }
    }
    return { updated: index >= 0, ...snapshot() };
  },
  clearChatQueue: async (_sid?: string, ids?: number[]) => { await defer("clearQueue"); const size = queueItems.length; queueItems = ids ? queueItems.filter(o => !ids.includes(o.id)) : []; return size - queueItems.length; },
  removeChatQueueItem: async (id: number) => { await defer("removeQueue"); queueItems = queueItems.filter(o => o.id !== id); return true; },
  createSession: () => defer("createSession"),
  switchSession: (id: string) => { record("switch", id); return defer("switchSession"); },
  setApprovalMode: async () => { record("approvalMode"); return meta; },
});
Object.assign(ports.files, { fetchProjectTree: async () => ({ tree: [] }), fetchMdTree: async () => ({ tree: [] }) });
Object.assign(ports.models, { fetchModels: (pid: string) => defer(`models:${pid}`) });
Object.assign(ports.shell, {
  fetchMeta: async () => meta,
  fetchAgents: async () => ({ agents: [], activeAgentName: "coding", activeSwitchId: "system:coding", activeProjectPath: null }),
  setActiveAgent: () => defer("setActiveAgent"),
  fetchTerminals: async () => [],
  fetchTodayUsage: async () => ({ inputTokens: 0, outputTokens: 0 }),
});

function ComposerFixture() {
  const [input, setInput] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const props = {
    variant: "live", input, inputEpoch: epoch, inputRef, busy,
    pendingApproval: false, sendMode: "queue", placeholder: "消息",
    statusDisplay: "", statusError: false, slashHits: [], slashIdx: 0,
    slashOpen: false, outbox: [], provider: "a", model: "a1", providers, models,
    approval: "normal", contextPct: null, canRetry: false, canSteerQueue: false,
    onInputChange: setInput, onInputKeyDown: () => {}, onCommandLaunch: () => {},
    onSend: () => { record("send", inputRef.current?.value); setInput(""); setEpoch((n) => n + 1); },
    onStop: () => record("stop"), onApprovalChange: () => {}, onRetryLast: () => {}, onCopyTranscript: () => {},
  } satisfies ComposerProps;
  return <><button onClick={() => setBusy(true)}>模拟运行</button><ComposerBar {...props} /></>;
}
function QueueFixture() {
  const [sid, setSid] = useState("s1");
  const queue = useChatQueue(sid, sid, ports.chat, message => record("queueStatus", message));
  (audit as any).consume = (id: number) => { const item = queueItems.find(o => o.id === id); queueItems = queueItems.filter(o => o.id !== id); queue.consume(id, item?.requestId); };
  const props = {
    outbox: queue.items, busy: queue.serverBusy, queueBusy: queue.serverBusy, queueCapacity: queue.capacity, queuePending: queue.pending, queueSyncError: queue.syncError,
    onClearOutbox: queue.clear, onRemoveOutbox: queue.remove,
    onEditOutbox: (item: any, text: string) => queue.update(item, { message: text }),
    onMoveOutbox: (item: any, move: "up" | "down") => queue.update(item, { move }),
    onRetryOutbox: (item: any) => queue.enqueue(item.text, item.mode, item),
    onSteerOutbox: (item: any) => queue.update(item, { mode: "insert" }),
    onRefreshQueue: queue.refresh,
    onResumeQueue: () => record("resumeQueue"),
  } as unknown as ComposerProps;
  return <div data-composer="" style={{ maxWidth: 620, margin: "24px auto" }}>
    <button onClick={() => void queue.enqueue("相同内容", "queue")}>添加相同消息</button>
    <button onClick={() => void queue.refresh()}>刷新队列</button>
    <button onClick={() => { meta.sessionId = sid === "s1" ? "s2" : "s1"; queueItems = []; setSid(meta.sessionId); }}>切换队列会话</button>
    <QueueDock {...props} />
  </div>;
}
function ProjectFixture() {
  const [mounted, setMounted] = useState(true);
  const [docs, setDocs] = useState([
    { path: "a.md", title: "A", kind: "doc" as const, content: "# Alpha" },
    { path: "b.md", title: "B", kind: "doc" as const, content: "# Beta" },
  ]);
  return <><button onClick={() => setDocs((d) => [...d])}>刷新文档列表</button><button onClick={() => setMounted((v) => !v)}>切换文档挂载</button>{mounted ? <ProjectWorkbench projectLabel="Test" projectPath="/test" docs={docs as any} onPersistMarkdown={(path, body) => { record("write", path, body); return defer(`write:${path}`); }} /> : null}</>;
}
function StubProjectFixture() {
  const [epoch, setEpoch] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const docs = [{ path: "a.md", title: "A", kind: "doc", content: loaded ? "# Loaded document" : "" }];
  return <><button onClick={() => setEpoch((n) => n + 1)}>重新打开文档</button><button onClick={() => setLoaded(true)}>完成加载</button><ProjectWorkbench key={epoch} projectLabel="Test" projectPath="/stub" docs={docs as any} loadedPaths={new Set(loaded ? ["a.md"] : [])} /></>;
}
function ChatFixture() {
  const [hidden, setHidden] = useState(false);
  return <><button onClick={() => setHidden((v) => !v)}>切换聊天可见性</button><input aria-label="外部输入框" /><div hidden={hidden}><ChatPanel chrome="wire" layout="codex" /></div></>;
}
function ApprovalsFixture() {
  return <>{["one", "two"].map((id) => <ApprovalBanner key={id} approval={{ id, summary: id, command: id, risk: "normal", agentName: "test" }} onDecision={(choice) => { record("decision", id, choice); return defer(`decision:${id}`); }} />)}</>;
}
function HostFixture() {
  const bag = useLiveHostBag();
  return <><button onClick={() => bag.agentList.onSelect("system:ops")}>选择 ops</button><output>{bag.chat?.remountKey}</output><p role="alert">{bag.notice}</p></>;
}
function ModalFixture() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>打开统计</button><input aria-label="外部输入框" /><SessionUsageModal open={open} onClose={() => setOpen(false)} sessionId="s1" stats={null} /></>;
}
function TerminalFixture() {
  const [mounted, setMounted] = useState(true);
  return <><button onClick={() => setMounted(false)}>卸载终端</button>{mounted ? <TerminalPanel /> : null}</>;
}
const kind = new URLSearchParams(location.search).get("case");
if (kind === "terminal") {
  class Socket extends EventTarget {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    readyState = 1;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    onopen?: () => void;
    constructor(public url: string) {
      super();
      (audit as any).sockets.push(this);
      record("socket", url);
      setTimeout(() => { this.onopen?.(); this.emit({ type: "ready", state: "ready" }); }, 0);
    }
    send(data: string) { record("socketSend", this.url, data); }
    emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
    close() { this.readyState = 3; setTimeout(() => this.onclose?.(), 0); }
  }
  (audit as any).sockets = [];
  (window as any).WebSocket = Socket;
  Object.assign(ports.terminals, {
    fetchTerminals: async () => [{ id: "t1", agentName: "coding", command: "first", state: "running" }, { id: "t2", agentName: "coding", command: "second", state: "running" }],
    fetchTerminalCapabilities: async () => ({ humanShell: true }),
    agentTerminalWsUrl: (id: string) => `ws://test/${id}`,
    stopTerminal: () => defer("stopTerminal"),
  });
}
if (kind === "live-project") {
  ports.files.fetchMdTree = async () => ({ root: "/test", tree: [{ type: "file", name: "a.md", path: "a.md" }] });
  ports.files.readFsFile = () => defer("readDoc");
  ports.files.writeFsFile = async (path, body) => { record("write", path, body); };
}
Object.assign(ports.settings, {
  fetchMeta: async () => meta,
  fetchModels: async () => ({ meta, models, providers }),
  fetchLlmConfig: async () => ({ configPath: "/test/config.json", providers: [], presets: [], roles: {}, catalog: [], protocols: [], roleDefs: [] }),
});
ports.terminals.fetchTerminals = kind === "terminal" ? ports.terminals.fetchTerminals : async () => [];
if (kind === "app") {
  meta.agentName = "ops";
  ports.shell.fetchAgents = async () => ({ agents: [], activityAgents: [], activeAgentName: "ops", activeSwitchId: "system:ops", activeProjectPath: null });
}
if (kind === "proactive") {
  Object.assign(ports.proactive, {
    fetchProactive: async () => ({ ok: true, projectRoot: "/test", board: { path: "", zones: [], items: [], raw: "" }, settings: { enabled: false, frequency: "off", intervalMinutes: 30, maxRunsPerDay: 20, autoZones: [], runsToday: 0, runsDay: "" }, job: { status: "idle" }, chat: [] }),
    streamProactiveChat: async function* (message: string) { record("proactiveSend", message); yield { type: "error", message: "Provider unavailable" }; },
  });
}
const slots = createLiveHostSlots();
const view = kind === "queue" ? <QueueFixture /> : kind === "composer" ? <ComposerFixture /> : kind === "models" ? <ModelCascadeMenu provider="a" model="a1" models={models} providers={providers} onSelect={(...args) => record("modelSelect", ...args)} /> : kind === "project" ? <ProjectFixture /> : kind === "approvals" ? <ApprovalsFixture /> : kind === "host" ? <HostFixture /> : kind === "modal" ? <ModalFixture /> : kind === "terminal" ? <TerminalFixture /> : kind === "plugins" ? <PluginsPanel /> : kind === "live-project" ? <LiveProjectHost projectLabel="Test" projectPath="/test" /> : kind === "app" ? <SlotsProvider slots={slots}><LiveApp /></SlotsProvider> : <ChatFixture />;
const extraView = kind === "project-stub" ? <StubProjectFixture /> : kind === "proactive" ? <ProactiveHost /> : kind === "folders" ? <FolderBrowse /> : view;
createRoot(document.getElementById("root")!).render(<PortsProvider ports={ports}>{extraView}</PortsProvider>);
