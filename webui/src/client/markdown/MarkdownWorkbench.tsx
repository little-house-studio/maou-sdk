/**
 * MarkdownWorkbench —— 文档工作台主壳
 *
 * 文件树 | 标题树 | 画布 | Copilot
 * 顶栏功能 · 底栏模式 · 悬浮气泡 · 右键菜单 · 批注
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createFsFile,
  fetchMdTree,
  readFsFile,
  writeFsFile,
  type FsTreeNode,
} from "./api";
import { FileTree } from "./file-tree/FileTree";
import { TitleTree } from "./title-tree/TitleTree";
import { DocumentCanvas } from "./canvas/DocumentCanvas";
import { SourceEditor } from "./editor/SourceEditor";
import { FunctionBar } from "./ui/FunctionBar";
import { ModeToolbar, type EditorMode } from "./ui/ModeToolbar";
import { FloatBubble } from "./ui/FloatBubble";
import { ContextMenu, type ContextMenuItem } from "./ui/ContextMenu";
import { CopilotPanel } from "./copilot/CopilotPanel";
import {
  parseMarkdownDocument,
  parseBlocksInRange,
  findSectionById,
  diffLines,
  type MdBlock,
  type MdSection,
  type DiffLine,
} from "./parser";
import {
  ANNOT_COLORS,
  formatAnnotationMessage,
  type AnnotateHit,
  type AnnotationGroup,
} from "./annotate/types";
import { streamChat } from "../api";
import { useDocHistory } from "./history";

export type MarkdownWorkbenchProps = {
  openPath?: string | null;
  onOpenConsumed?: () => void;
};

/** 聚焦节：sec-root = 前言 + 全部顶层标题树 */
function resolveFocusSection(
  doc: ReturnType<typeof parseMarkdownDocument>,
  focusId: string | null,
): MdSection {
  if (!focusId || focusId === "sec-root") {
    const end = doc.sections[0]?.lineStart ?? doc.lines.length;
    return {
      id: "sec-root",
      title: "Document",
      level: 0,
      lineStart: 0,
      lineEnd: doc.lines.length,
      blocks: parseBlocksInRange(doc.lines, 0, end),
      children: doc.sections,
    };
  }
  return (
    findSectionById(doc.sections, focusId) ?? {
      id: "sec-root",
      title: "Document",
      level: 0,
      lineStart: 0,
      lineEnd: doc.lines.length,
      blocks: [],
      children: doc.sections,
    }
  );
}

export function MarkdownWorkbench({
  openPath,
  onOpenConsumed,
}: MarkdownWorkbenchProps) {
  const [tree, setTree] = useState<FsTreeNode[]>([]);
  const [root, setRoot] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const {
    content,
    setContent,
    setContentLive,
    reset: resetHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDocHistory("");
  const [saved, setSaved] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<EditorMode>("browse");
  const [focusSectionId, setFocusSectionId] = useState<string | null>("sec-root");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [annotGroups, setAnnotGroups] = useState<AnnotationGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [float, setFloat] = useState({
    visible: false,
    x: 0,
    y: 0,
    place: "above" as "above" | "below",
    note: "",
  });
  const [ctx, setCtx] = useState<{
    visible: boolean;
    x: number;
    y: number;
    block: MdBlock | null;
  }>({ visible: false, x: 0, y: 0, block: null });
  const [alignBusy, setAlignBusy] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<DiffLine[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);

  const dirty = path != null && content !== saved;

  const doc = useMemo(() => parseMarkdownDocument(content || ""), [content]);

  const canvasSection = useMemo(
    () => resolveFocusSection(doc, focusSectionId),
    [doc, focusSectionId],
  );

  const annotColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of annotGroups) {
      for (const h of g.hits) m.set(h.targetId, g.color);
    }
    return m;
  }, [annotGroups]);

  const refreshTree = useCallback(async () => {
    try {
      const { root: r, tree: t } = await fetchMdTree();
      setRoot(r);
      setTree(t);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  const openFile = useCallback(async (p: string) => {
    setBusy(true);
    setStatus("loading…");
    try {
      const f = await readFsFile(p);
      setPath(f.path);
      resetHistory(f.content);
      setSaved(f.content);
      setStatus(f.path);
      setFocusSectionId("sec-root");
      setSelectedIds(new Set());
      setAnnotGroups([]);
      setMode("browse");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [resetHistory]);

  useEffect(() => {
    if (!openPath) return;
    void openFile(openPath).then(() => onOpenConsumed?.());
  }, [openPath, openFile, onOpenConsumed]);

  const save = useCallback(async () => {
    if (!path) return;
    setBusy(true);
    try {
      await writeFsFile(path, content);
      setSaved(content);
      setStatus(`已保存 · ${path}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [path, content]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "s") {
        e.preventDefault();
        void save();
        return;
      }
      // ⌘Z 撤回 · ⌘⇧Z / Ctrl+Y 重做
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (e.shiftKey) {
          e.preventDefault();
          if (redo()) setStatus("已重做");
        } else {
          e.preventDefault();
          if (undo()) setStatus("已撤回");
        }
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        if (redo()) setStatus("已重做");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo]);

  const onNew = async () => {
    const name = window.prompt("新 Markdown 路径（相对项目根）", "docs/note.md");
    if (!name) return;
    try {
      const p = await createFsFile(name);
      await refreshTree();
      await openFile(p);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  /** 对齐 → 主 Agent */
  const sendAlign = useCallback(
    async (extra?: string) => {
      if (!path) {
        setStatus("请先打开文档");
        return;
      }
      const annotMsg = formatAnnotationMessage(annotGroups);
      const changeHint =
        dirty
          ? `\n\n（文档有未保存修改，请结合当前编辑器内容对齐。）\n当前文件：${path}`
          : `\n\n当前文件：${path}`;
      const message =
        `请对齐项目需求文档「${path}」。` +
        (annotMsg ? `\n\n批注与范围：\n${annotMsg}` : "") +
        (extra ? `\n\n补充：${extra}` : "") +
        changeHint +
        (dirty ? `\n\n--- 文档正文 ---\n${content.slice(0, 12000)}` : "");

      setAlignBusy(true);
      setStatus("正在发送对齐指令给主 Agent…");
      try {
        let last = "";
        for await (const ev of streamChat(message)) {
          if (ev.type === "assistant" || ev.type === "assistant_delta") {
            last = String(ev.content ?? ev.delta ?? last);
          }
          if (ev.type === "error") {
            throw new Error(String(ev.message ?? "align failed"));
          }
        }
        setStatus("对齐指令已发送主 Agent");
        setPendingDiff(diffLines(saved, content));
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      } finally {
        setAlignBusy(false);
      }
    },
    [path, annotGroups, dirty, content, saved],
  );

  /** 气泡锚点：选中卡片顶边中心（相对 workbench），正上方弹出 */
  const bubbleAnchorFromEvent = (e: React.MouseEvent) => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0, place: "above" as const };
    const hostRect = host.getBoundingClientRect();
    const card =
      (e.currentTarget as HTMLElement | null)?.closest?.(".mdc-block") ??
      (e.target as HTMLElement | null)?.closest?.(".mdc-block");
    if (card) {
      const cr = card.getBoundingClientRect();
      const x = cr.left - hostRect.left + cr.width / 2;
      // 卡片顶边；气泡用 translateY(-100%) 再上移 gap
      const y = cr.top - hostRect.top;
      // 若顶部空间不够，改到卡片下方
      const place = y < 56 ? ("below" as const) : ("above" as const);
      return { x, y: place === "below" ? cr.bottom - hostRect.top : y, place };
    }
    return {
      x: e.clientX - hostRect.left,
      y: e.clientY - hostRect.top,
      place: "above" as const,
    };
  };

  /** 正文编辑回写 markdown 源 */
  const onProseChange = useCallback((block: MdBlock, plain: string) => {
    setContent((prev) => {
      const lines = prev.replace(/\r\n/g, "\n").split("\n");
      const start = block.lineStart;
      const end = Math.max(start + 1, block.lineEnd);
      if (start < 0 || start >= lines.length) return prev;

      if (block.kind === "heading") {
        const lv = block.headingLevel ?? 1;
        lines[start] = `${"#".repeat(lv)} ${plain}`;
        return lines.join("\n");
      }
      if (block.kind === "code") {
        // 保留 fence 行，替换中间
        const open = lines[start] ?? "```";
        let closeIdx = end - 1;
        while (closeIdx > start && !/^\s*(```|~~~)/.test(lines[closeIdx] ?? "")) {
          closeIdx -= 1;
        }
        if (closeIdx <= start) closeIdx = end - 1;
        const close = lines[closeIdx] ?? "```";
        const body = plain.split("\n");
        return [
          ...lines.slice(0, start),
          open,
          ...body,
          close,
          ...lines.slice(closeIdx + 1),
        ].join("\n");
      }
      if (block.kind === "list_item" || block.kind === "task") {
        const line = lines[start] ?? "";
        const m = line.match(/^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)/);
        const prefix = m?.[1] ?? "- ";
        lines[start] = `${prefix}${plain}`;
        return lines.join("\n");
      }
      if (block.kind === "blockquote") {
        const body = plain.split("\n").map((l) => `> ${l}`);
        return [
          ...lines.slice(0, start),
          ...body,
          ...lines.slice(end),
        ].join("\n");
      }
      // paragraph
      const body = plain.split("\n");
      return [...lines.slice(0, start), ...body, ...lines.slice(end)].join("\n");
    });
  }, []);

  const onSelectBlock = useCallback(
    (block: MdBlock, e: React.MouseEvent) => {
      const { x, y, place } = bubbleAnchorFromEvent(e);

      // 浏览模式：仅整块 list / code / table 弹气泡；正文编辑不弹
      const cardLike =
        block.kind === "list" ||
        block.kind === "code" ||
        block.kind === "table";
      // 列表内单项：批注模式可选；浏览模式选中父 list（若点在项上）
      if (mode === "browse" && !cardLike) {
        if (block.kind === "list_item" || block.kind === "task") {
          // 仍允许对单项出气泡（批注友好），算作小卡片交互
        } else {
          return;
        }
      }

      if (mode === "annotate") {
        const hit: AnnotateHit = {
          id: `hit-${block.id}-${Date.now()}`,
          targetId: block.id,
          filePath: path || "?",
          lineStart: block.lineStart,
          lineEnd: block.lineEnd,
          text: block.text,
        };
        setSelectedIds((prev) => {
          const n = new Set(prev);
          n.add(block.id);
          return n;
        });
        setAnnotGroups((prev) => {
          let groups = [...prev];
          let gid = activeGroupId;
          let g = groups.find((x) => x.id === gid);
          if (!g) {
            const color = ANNOT_COLORS[groups.length % ANNOT_COLORS.length]!;
            g = { id: `ag-${Date.now()}`, color, note: "", hits: [] };
            groups = [...groups, g];
            setActiveGroupId(g.id);
          }
          if (!g.hits.some((h) => h.targetId === block.id)) {
            g = { ...g, hits: [...g.hits, hit] };
            groups = groups.map((x) => (x.id === g!.id ? g! : x));
          }
          return groups;
        });
        setFloat({ visible: true, x, y, place, note: "" });
        return;
      }

      setSelectedIds(new Set([block.id]));
      setFloat({ visible: true, x, y, place, note: "" });
    },
    [mode, path, activeGroupId],
  );

  const onContextMenu = useCallback((block: MdBlock, e: React.MouseEvent) => {
    const rect = hostRef.current?.getBoundingClientRect();
    setCtx({
      visible: true,
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
      block,
    });
  }, []);

  const ctxItems: ContextMenuItem[] = useMemo(() => {
    const b = ctx.block;
    if (!b) return [];
    const items: ContextMenuItem[] = [
      { id: "annotate", label: "加入批注选区" },
      { id: "align", label: "对齐此段" },
      { id: "copy", label: "复制文本" },
    ];
    if (b.kind === "task") {
      items.unshift({ id: "toggle-task", label: b.checked ? "标记未完成" : "标记完成" });
    }
    if (b.kind === "code") {
      items.push({ id: "copy-code", label: "复制代码" });
    }
    if (b.kind === "heading") {
      items.push({ id: "focus-section", label: "仅显示此标题层级" });
    }
    return items;
  }, [ctx.block]);

  const onCtxPick = (id: string) => {
    const b = ctx.block;
    if (!b) return;
    if (id === "copy" || id === "copy-code") {
      void navigator.clipboard?.writeText(b.code || b.text);
      setStatus("已复制");
    }
    if (id === "annotate") {
      setMode("annotate");
      onSelectBlock(b, {
        clientX: ctx.x,
        clientY: ctx.y,
      } as React.MouseEvent);
    }
    if (id === "align") {
      void sendAlign(`聚焦段落 L${b.lineStart + 1}: ${b.text.slice(0, 200)}`);
    }
    if (id === "toggle-task") toggleTask(b);
    if (id === "focus-section" && b.kind === "heading") {
      setFocusSectionId(b.id);
    }
  };

  const toggleTask = (block: MdBlock) => {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const li = block.lineStart;
    if (li < 0 || li >= lines.length) return;
    const line = lines[li]!;
    if (block.checked) {
      lines[li] = line.replace(/\[x\]/i, "[ ]");
    } else {
      lines[li] = line.replace(/\[\s?\]/, "[x]");
      // 子任务一并勾选：后续缩进更大的 task 行
      const baseIndent = (line.match(/^\s*/)?.[0].length ?? 0);
      for (let i = li + 1; i < lines.length; i++) {
        const L = lines[i]!;
        if (!L.trim()) continue;
        const ind = L.match(/^\s*/)?.[0].length ?? 0;
        if (ind <= baseIndent) break;
        if (/^\s*[-*+]\s+\[\s?\]/.test(L)) {
          lines[i] = L.replace(/\[\s?\]/, "[x]");
        }
      }
    }
    setContent(lines.join("\n"));
  };

  const tableToMd = (rows: string[][]): string => {
    if (!rows.length) return "";
    const cols = Math.max(...rows.map((r) => r.length));
    const norm = rows.map((r) => {
      const x = [...r];
      while (x.length < cols) x.push("");
      return x;
    });
    const head = `| ${norm[0]!.join(" | ")} |`;
    const sep = `| ${norm[0]!.map(() => "---").join(" | ")} |`;
    const body = norm.slice(1).map((r) => `| ${r.join(" | ")} |`);
    return [head, sep, ...body].join("\n");
  };

  const onTableChange = (block: MdBlock, rows: string[][]) => {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const md = tableToMd(rows).split("\n");
    const before = lines.slice(0, block.lineStart);
    const after = lines.slice(block.lineEnd);
    setContent([...before, ...md, ...after].join("\n"));
  };

  const confirmAnnotate = () => {
    if (!activeGroupId) return;
    setAnnotGroups((prev) =>
      prev.map((g) =>
        g.id === activeGroupId
          ? { ...g, note: float.note || g.note, quickTag: g.quickTag }
          : g,
      ),
    );
    setStatus("批注已记录（同色为同一备注组）");
    setFloat((f) => ({ ...f, visible: false }));
  };

  const closeFloat = useCallback(() => {
    setFloat((f) => (f.visible ? { ...f, visible: false } : f));
  }, []);

  // 点击气泡以外任意处（含空白、正文、其它栏）→ 关闭
  // 若点到会重新打开气泡的卡片，仍先关再由 click 打开新位置
  useEffect(() => {
    if (!float.visible) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".md-float-bubble")) return;
      closeFloat();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFloat();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [float.visible, closeFloat]);

  const hitCount = annotGroups.reduce((s, g) => s + g.hits.length, 0);

  const annotText = useMemo(
    () => formatAnnotationMessage(annotGroups),
    [annotGroups],
  );

  /** Copilot 改文件后重新加载当前文档（若路径仍在） */
  const reloadCurrentFile = useCallback(async () => {
    if (!path) return;
    try {
      const f = await readFsFile(path);
      // 不 reset 历史：合并为一次外部变更
      setContent(f.content);
      setStatus(`已同步磁盘 · ${path}`);
    } catch {
      /* ignore */
    }
  }, [path, setContent]);

  return (
    <div className="panel editor-panel md-workbench" ref={hostRef}>
      <FunctionBar
        filePath={path}
        dirty={dirty}
        busy={busy || alignBusy}
        onSave={() => void save()}
        onRefresh={() => void refreshTree()}
        onNew={() => void onNew()}
        onAlign={() => void sendAlign()}
        alignDisabled={!path || alignBusy}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => {
          if (undo()) setStatus("已撤回");
        }}
        onRedo={() => {
          if (redo()) setStatus("已重做");
        }}
      />

      <div className="md-workbench-body">
        <FileTree
          tree={tree}
          activePath={path}
          projectRoot={root}
          onOpen={(p) => void openFile(p)}
        />

        {path ? (
          <>
            <TitleTree
              sections={doc.sections}
              activeId={focusSectionId}
              onSelect={setFocusSectionId}
            />

            <div className="md-main-stage">
              {mode === "source" ? (
                <SourceEditor
                  value={content}
                  editable={!busy}
                  onChange={setContentLive}
                />
              ) : (
                <DocumentCanvas
                  section={canvasSection}
                  filePath={path}
                  mode={mode === "annotate" ? "annotate" : "browse"}
                  selectedIds={selectedIds}
                  annotColors={annotColors}
                  onSelectBlock={onSelectBlock}
                  onContextMenu={onContextMenu}
                  onToggleTask={toggleTask}
                  onTableChange={onTableChange}
                  onProseChange={onProseChange}
                  onSelectSection={setFocusSectionId}
                />
              )}
              <ModeToolbar
                mode={mode}
                onChange={setMode}
                annotateCount={hitCount}
              />
            </div>

            <CopilotPanel
              projectHint={root}
              filePath={path}
              documentContent={content}
              annotations={annotText || undefined}
              pendingDiff={pendingDiff}
              onDocMaybeChanged={() => void reloadCurrentFile()}
              onAcceptAll={() => {
                setSaved(content);
                setPendingDiff([]);
                setStatus("已全部同意（保留当前正文）");
              }}
              onRejectAll={() => {
                setContent(saved);
                setPendingDiff([]);
                setStatus("已全部放弃（恢复上次保存）");
              }}
            />
          </>
        ) : (
          <div className="md-editor-empty md-main-stage">
            从左侧选择 <strong>.md</strong> 文件，或点「新建」。
            <br />
            画布 · 标题树 · 批注 · 对齐 · Copilot 工作台
          </div>
        )}
      </div>

      <div className="md-status">
        {status}
        {mode === "annotate" ? " · 批注多选：点击节点/块加入选区" : ""}
      </div>

      <FloatBubble
        visible={float.visible}
        x={float.x}
        y={float.y}
        place={float.place}
        mode={mode === "annotate" ? "annotate" : "browse"}
        note={float.note}
        onNoteChange={(v) => setFloat((f) => ({ ...f, note: v }))}
        onQuick={(tag) => {
          setFloat((f) => ({ ...f, note: tag }));
          if (activeGroupId) {
            setAnnotGroups((prev) =>
              prev.map((g) =>
                g.id === activeGroupId ? { ...g, note: tag, quickTag: tag } : g,
              ),
            );
          }
        }}
        onConfirmAnnotate={confirmAnnotate}
        onAlignSelection={() => {
          void sendAlign(float.note || undefined);
          setFloat((f) => ({ ...f, visible: false }));
        }}
        onClose={closeFloat}
      />

      <ContextMenu
        visible={ctx.visible}
        x={ctx.x}
        y={ctx.y}
        items={ctxItems}
        onPick={onCtxPick}
        onClose={() => setCtx((c) => ({ ...c, visible: false }))}
      />
    </div>
  );
}

export const EditorPanel = MarkdownWorkbench;
