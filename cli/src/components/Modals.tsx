/** 弹窗 —— 模型选择 / 命令面板 / 会话选择 / 帮助（不透明 Dialog + 投影，不透底） */
import React, { useState, useMemo, useEffect } from "react";
import { join } from "node:path";
import { currentTheme } from "../theme.js";
import { useStore, getConfig } from "../state/store.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
import { Dialog, type DialogRow, padEndWidth } from "./Dialog.js";

export function ModelPicker() {
  const t = currentTheme;
  const setModal = useStore((s) => s.setModal);
  const setProviderModel = useStore((s) => s.setProviderModel);
  const toastMsg = useStore((s) => s.toastMsg);
  const flat = useMemo(() => {
    const cfg = getConfig();
    const providers = cfg?.getProviders?.() ?? [];
    const out: { provider: string; model: string; name: string }[] = [];
    for (const p of providers) {
      const models = cfg?.getModels?.(p.id) ?? [];
      for (const m of models.slice(0, 6)) out.push({ provider: p.id, model: m.id, name: m.name ?? m.id });
    }
    return out;
  }, []);
  const [sel, setSel] = useState(0);
  const [filter, setFilter] = useState("");
  const filtered = flat.filter((x) => (x.provider + x.model + x.name).toLowerCase().includes(filter.toLowerCase()));
  useCleanInput((input, key) => {
    if (key.escape) return setModal(null);
    if (key.upArrow) return setSel((s) => Math.max(0, s - 1));
    if (key.downArrow) return setSel((s) => Math.min(filtered.length - 1, s + 1));
    if (key.return) {
      const c = filtered[sel];
      if (c) { setProviderModel(c.provider, c.model); toastMsg(`已切换到 ${c.provider}/${c.model}`, "ok"); }
      return setModal(null);
    }
    if (key.backspace || key.delete) return setFilter((f) => f.slice(0, -1));
    if (input && !key.ctrl) { setFilter((f) => f + input); setSel(0); }
  });
  const base = Math.max(0, Math.min(sel - 4, Math.max(0, filtered.length - 10)));
  const window = filtered.slice(base, base + 10);
  const rows: DialogRow[] = [
    [{ text: `► ${filter || "（输入筛选）"}`, color: t.overlayFg }],
    ...window.map((x) => [
      { text: padEndWidth(x.provider, 12), color: t.role.user },
      { text: " " + x.name, color: t.overlayFg },
    ]),
  ];
  return (
    <Dialog
      title="◆ 选择模型"
      width={58}
      rows={rows}
      selected={sel - base + 1}
      footer={`↑↓ 选 · ↵ 确认 · Esc 取消 · 共 ${filtered.length}`}
    />
  );
}

const COMMANDS = [
  { id: "new", label: "新建对话", desc: "清空当前会话" },
  { id: "sessions", label: "切换会话", desc: "选择历史会话" },
  { id: "model", label: "选择模型", desc: "切换 provider/model" },
  { id: "theme", label: "切换主题", desc: "vampire / cyber" },
  { id: "clear", label: "清屏", desc: "清空消息" },
  { id: "help", label: "帮助", desc: "快捷键说明" },
  { id: "quit", label: "退出", desc: "关闭 Maou CLI" },
];

export function CommandPalette({ onRun }: { onRun: (id: string) => void }) {
  const t = currentTheme;
  const setModal = useStore((s) => s.setModal);
  const [sel, setSel] = useState(0);
  const [filter, setFilter] = useState("");
  const filtered = COMMANDS.filter((c) => (c.label + c.desc).toLowerCase().includes(filter.toLowerCase()));
  useCleanInput((input, key) => {
    if (key.escape) return setModal(null);
    if (key.upArrow) return setSel((s) => Math.max(0, s - 1));
    if (key.downArrow) return setSel((s) => Math.min(filtered.length - 1, s + 1));
    if (key.return) { const c = filtered[sel]; if (c) onRun(c.id); return; }
    if (key.backspace || key.delete) return setFilter((f) => f.slice(0, -1));
    if (input && !key.ctrl) { setFilter((f) => f + input); setSel(0); }
  });
  const rows: DialogRow[] = [
    [{ text: `› ${filter}`, color: t.overlayFg }],
    ...filtered.map((c) => [
      { text: padEndWidth(c.label, 8), color: t.overlayFg, bold: true },
      { text: "  " + c.desc, color: t.dim },
    ]),
  ];
  return (
    <Dialog title="► 命令面板" width={50} rows={rows} selected={sel + 1} footer="↑↓ 选 · ↵ 执行 · Esc 取消" />
  );
}

export function HelpModal() {
  const t = currentTheme;
  const setModal = useStore((s) => s.setModal);
  useCleanInput((_i, key) => { if (key.escape || key.return) setModal(null); });
  const keys: [string, string][] = [
    ["↵ Enter", "发送消息"],
    ["Meta+Enter", "换行"],
    ["Meta+退格", "快速退词"],
    ["Esc", "中断流式 / 关闭弹窗"],
    ["Ctrl+K", "命令面板"],
    ["Ctrl+M", "选择模型"],
    ["Ctrl+N", "新对话"],
    ["Ctrl+B / Ctrl+H", "切换侧栏 / HUD"],
    ["Tab", "切换焦点面板"],
    ["` (反引号)", "开/关鼠标（关=可拖选复制）"],
    ["Ctrl+C", "退出"],
  ];
  const rows: DialogRow[] = keys.map(([k, d]) => [
    { text: padEndWidth(k, 16), color: t.accent, bold: true },
    { text: d, color: t.overlayFg },
  ]);
  return <Dialog title="? 快捷键" width={52} rows={rows} footer="Esc 关闭" />;
}

/** 会话选择弹窗 —— 列出 SessionStore 历史会话，切换 sessionId */
export function SessionPicker() {
  const t = currentTheme;
  const setModal = useStore((s) => s.setModal);
  const setSessionId = useStore((s) => s.setSessionId);
  const clearMessages = useStore((s) => s.clearMessages);
  const toastMsg = useStore((s) => s.toastMsg);
  const [sessions, setSessions] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    try {
      const cfg = getConfig();
      if (!cfg) return;
      const handle = cfg.createAgent(process.cwd(), join(process.env.HOME ?? "", ".maou"));
      const store = (handle.runtime as unknown as { sessions?: { list?: () => Array<{ id: string; title?: string; updatedAt?: string }> } }).sessions;
      const list = store?.list?.() ?? [];
      setSessions(list.map((s) => ({ id: s.id, title: s.title ?? s.id, updatedAt: s.updatedAt ?? "" })));
    } catch { /* ignore */ }
  }, []);

  useCleanInput((_input, key) => {
    if (key.escape) return setModal(null);
    if (key.upArrow) return setSel((s) => Math.max(0, s - 1));
    if (key.downArrow) return setSel((s) => Math.min(sessions.length - 1, s + 1));
    if (key.return) {
      const c = sessions[sel];
      if (c) {
        setSessionId(c.id);
        clearMessages();
        toastMsg(`已切换到会话 ${c.title}`, "ok");
      }
      return setModal(null);
    }
  });

  const base = Math.max(0, Math.min(sel - 4, Math.max(0, sessions.length - 10)));
  const window = sessions.slice(base, base + 10);
  const rows: DialogRow[] = window.length === 0
    ? [[{ text: "（暂无历史会话）", color: t.dim }]]
    : window.map((s) => [
        { text: padEndWidth(s.id.slice(-12), 14), color: t.role.user },
        { text: " " + s.title.slice(0, 30), color: t.overlayFg },
      ]);
  return (
    <Dialog
      title="📂 选择会话"
      width={58}
      rows={rows}
      selected={sel - base}
      footer={`↑↓ 选 · ↵ 切换 · Esc 取消 · 共 ${sessions.length}`}
    />
  );
}
