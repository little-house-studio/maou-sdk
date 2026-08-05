/**
 * 设置：LLM 配置与模板（真全局 config）
 *
 * 1. LLM 层 — 单个模型 preset（厂商 + 模型 + 隐藏参数）
 * 2. Agent 层 — 主/小/多模态 方案绑定
 * 3. 模板默认 — 同 roles（运行时 resolveApiRolePreset）
 * + 终端审批
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLlmConfig,
  fetchMeta,
  fetchModels,
  fetchSvgProbeGallery,
  runLlmSvgProbe,
  saveLlmConfig,
  setApprovalMode,
  setModel,
  setSvgProbeReference,
  testLlmConnection,
  type ApprovalMode,
  type LlmConfigPresetDto,
  type LlmConfigRoles,
  type LlmConfigSnapshot,
  type LlmConnectionTestResult,
  type Meta,
  type SvgProbeGalleryItem,
} from "../api";
import { UiEmoji } from "../ui-emoji";
import {
  APPROVAL_MODES,
  LIVE_SETTINGS_SECTIONS,
  approvalModeHint,
  approvalModeLabel,
  buildLiveSettingsSnapshot,
  emptyLiveSettingsSnapshot,
  isApprovalMode,
  resolveModelAfterProviderChange,
  withApprovalMode,
  type LiveSettingsSectionId,
  type LiveSettingsSnapshot,
} from "./settings-adapters";

export type LiveSettingsPanelProps = {
  onClose?: () => void;
  onMetaChange?: (meta: Meta) => void;
  presentation?: "page" | "overlay";
};

type DraftRow = {
  name: string;
  vendor: string;
  protocol: string;
  url: string;
  urlParams: string;
  model: string;
  keyEdit: string;
  keyMasked: string;
  hasKey: boolean;
  maxContext: number;
  maxTokens: number;
  supportsImage: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsReasoning: boolean;
  nativeToolCalling: boolean;
  inputPricePerMt: string;
  outputPricePerMt: string;
  cacheHitPricePerMt: string;
  maxConcurrent: string;
  temperature: string;
  topP: string;
  presencePenalty: string;
  frequencyPenalty: string;
  customRequestJson: string;
  showAdvanced: boolean;
};

function dtoToDraft(p: LlmConfigPresetDto): DraftRow {
  return {
    name: p.name,
    vendor: p.vendor || "custom",
    protocol: p.protocol || "openai",
    url: p.url,
    urlParams: p.urlParams || "",
    model: p.model,
    keyEdit: "",
    keyMasked: p.keyMasked,
    hasKey: p.hasKey,
    maxContext: p.maxContext,
    maxTokens: p.maxTokens,
    supportsImage: p.supportsImage,
    supportsAudio: p.supportsAudio,
    supportsVideo: p.supportsVideo,
    supportsReasoning: p.supportsReasoning,
    nativeToolCalling: p.nativeToolCalling,
    inputPricePerMt: p.inputPricePerMt || "",
    outputPricePerMt: p.outputPricePerMt || "",
    cacheHitPricePerMt: p.cacheHitPricePerMt || "",
    maxConcurrent: p.maxConcurrent || "",
    temperature: p.temperature || "",
    topP: p.topP || "",
    presencePenalty: p.presencePenalty || "",
    frequencyPenalty: p.frequencyPenalty || "",
    customRequestJson: p.customRequestJson || "",
    showAdvanced: false,
  };
}

function emptyDraft(n: number): DraftRow {
  return {
    name: `model-${n}`,
    vendor: "openai",
    protocol: "openai",
    url: "https://api.openai.com/v1",
    urlParams: "",
    model: "",
    keyEdit: "",
    keyMasked: "（未设置）",
    hasKey: false,
    maxContext: 128_000,
    maxTokens: 32_768,
    supportsImage: false,
    supportsAudio: false,
    supportsVideo: false,
    supportsReasoning: false,
    nativeToolCalling: true,
    inputPricePerMt: "",
    outputPricePerMt: "",
    cacheHitPricePerMt: "",
    maxConcurrent: "",
    temperature: "",
    topP: "",
    presencePenalty: "",
    frequencyPenalty: "",
    customRequestJson: "",
    showAdvanced: false,
  };
}

/** 厂商连接指纹：同 URL/协议/厂商 归为一组（组内可多模型） */
function connectionKey(r: DraftRow): string {
  return `${r.protocol || "openai"}|${r.vendor || "custom"}|${(r.url || "").trim()}`;
}

type VendorGroup = {
  key: string;
  label: string;
  indices: number[];
};

function buildVendorGroups(rows: DraftRow[]): VendorGroup[] {
  const order: string[] = [];
  const map = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = connectionKey(r);
    if (!map.has(k)) {
      map.set(k, []);
      order.push(k);
    }
    map.get(k)!.push(i);
  });
  return order.map((k) => {
    const indices = map.get(k)!;
    const first = rows[indices[0]!];
    // 组名：优先「不含 / 的 name」，否则 name 前缀
    const raw = (first?.name || "厂商").trim();
    const label = raw.includes("/") ? raw.split("/")[0]! : raw;
    return { key: k, label: label || "厂商", indices };
  });
}

function uniquePresetName(base: string, existing: string[]): string {
  const set = new Set(existing.map((x) => x.trim()).filter(Boolean));
  if (!set.has(base)) return base;
  for (let i = 2; i < 999; i++) {
    const n = `${base}-${i}`;
    if (!set.has(n)) return n;
  }
  return `${base}-${Date.now()}`;
}

export function LiveSettingsPanel({
  onClose,
  onMetaChange,
  presentation = "page",
}: LiveSettingsPanelProps) {
  const [snap, setSnap] = useState<LiveSettingsSnapshot>(() =>
    emptyLiveSettingsSnapshot(true),
  );
  const [section, setSection] =
    useState<LiveSettingsSectionId>("runtime_defaults");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<LlmConnectionTestResult | null>(
    null,
  );
  const [svgProbeBusy, setSvgProbeBusy] = useState(false);
  const [svgProbeSubject, setSvgProbeSubject] = useState(
    "一只简笔画小狗站在小舞台上，抬起一条后腿",
  );
  const [svgGallery, setSvgGallery] = useState<SvgProbeGalleryItem[]>([]);
  const [svgReference, setSvgReference] =
    useState<SvgProbeGalleryItem | null>(null);
  const [svgProbeMsg, setSvgProbeMsg] = useState("");

  const [cfgPath, setCfgPath] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [roles, setRoles] = useState<LlmConfigRoles>({});
  const [vendors, setVendors] = useState<LlmConfigSnapshot["vendors"]>([]);
  const [roleDefs, setRoleDefs] = useState<LlmConfigSnapshot["roleDefs"]>([]);
  const [revealKey, setRevealKey] = useState(false);

  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lastPushedRef = useRef<{
    provider: string;
    model: string;
    approvalMode: string;
  } | null>(null);

  const applySnapshot = useCallback((meta: Meta | null, catalogs?: {
    providers?: { id: string; name?: string }[];
    models?: { id: string; name?: string }[];
  }) => {
    const next = buildLiveSettingsSnapshot(meta, catalogs);
    setSnap(next);
    if (!meta) return;
    const approval = meta.approvalMode || meta.sandboxMode || "";
    const prev = lastPushedRef.current;
    if (
      !prev ||
      prev.provider !== meta.provider ||
      prev.model !== meta.model ||
      prev.approvalMode !== approval
    ) {
      lastPushedRef.current = {
        provider: meta.provider || "",
        model: meta.model || "",
        approvalMode: approval,
      };
      onMetaChangeRef.current?.(meta);
    }
  }, []);

  const applyLlmSnap = useCallback((s: LlmConfigSnapshot) => {
    setCfgPath(s.configPath);
    setRows(s.presets.map(dtoToDraft));
    setRoles(s.roles || {});
    setVendors(s.vendors || []);
    setRoleDefs(s.roleDefs || []);
    setSelected((i) =>
      s.presets.length === 0
        ? 0
        : Math.min(i, Math.max(0, s.presets.length - 1)),
    );
  }, []);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const llm = await fetchLlmConfig();
      applyLlmSnap(llm);
      const meta = await fetchMeta();
      const md = await fetchModels(meta.provider || undefined);
      applySnapshot(md.meta.provider ? md.meta : meta, {
        providers: md.providers,
        models: md.models,
      });
      setStatus("已从全局 config 同步");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSnap(emptyLiveSettingsSnapshot(true));
    } finally {
      setBusy(false);
    }
  }, [applyLlmSnap, applySnapshot]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedSafe = Math.min(selected, Math.max(0, rows.length - 1));
  const row = rows[selectedSafe] ?? null;
  const presetNames = rows.map((r) => r.name.trim()).filter(Boolean);
  const vendorGroups = buildVendorGroups(rows);
  const activeGroup =
    vendorGroups.find((g) => g.indices.includes(selectedSafe)) ??
    vendorGroups[0] ??
    null;
  const groupModelIndices = activeGroup?.indices ?? [];

  const patchRow = (patch: Partial<DraftRow>) => {
    if (!row) return;
    setRows((prev) => {
      const next = [...prev];
      next[selectedSafe] = { ...next[selectedSafe]!, ...patch };
      return next;
    });
  };

  /** 厂商连接字段：同步到同组全部模型 */
  const patchConnection = (patch: Partial<DraftRow>) => {
    if (!activeGroup) {
      patchRow(patch);
      return;
    }
    setRows((prev) => {
      const next = [...prev];
      for (const i of activeGroup.indices) {
        next[i] = { ...next[i]!, ...patch };
      }
      return next;
    });
  };

  const onVendorChange = (vendorId: string) => {
    const v = vendors.find((x) => x.id === vendorId);
    if (!v) {
      patchConnection({ vendor: vendorId });
      return;
    }
    patchConnection({
      vendor: v.id,
      protocol: v.protocol,
      url: v.defaultUrl || row?.url || "",
    });
  };

  const onAddVendor = () => {
    const n = rows.length + 1;
    const draft = emptyDraft(n);
    draft.name = uniquePresetName(`provider-${n}`, presetNames);
    setRows((prev) => [...prev, draft]);
    setSelected(rows.length);
    setRevealKey(false);
    setTestResult(null);
  };

  const onAddModelInVendor = () => {
    if (!row || !activeGroup) {
      onAddVendor();
      return;
    }
    const base = rows[activeGroup.indices[0]!]!;
    const names = rows.map((r) => r.name);
    const label = activeGroup.label || base.name || "model";
    const newName = uniquePresetName(`${label}/model`, names);
    const draft: DraftRow = {
      ...base,
      name: newName,
      model: "",
      maxContext: base.maxContext || 128_000,
      maxTokens: base.maxTokens || 32_768,
      keyEdit: base.keyEdit,
      showAdvanced: false,
    };
    setRows((prev) => {
      // 插在同组末尾
      const last = activeGroup.indices[activeGroup.indices.length - 1]!;
      const next = [...prev];
      next.splice(last + 1, 0, draft);
      return next;
    });
    setSelected(activeGroup.indices[activeGroup.indices.length - 1]! + 1);
    setTestResult(null);
  };

  const buildWritePayload = () => {
    for (const r of rows) {
      if (!r.name.trim() || !r.url.trim() || !r.model.trim()) {
        throw new Error("每个模型需要：自定义名称、URL、model name");
      }
    }
    const mainName = roles.main || rows[0]?.name;
    const defaultPreset = Math.max(
      0,
      rows.findIndex((r) => r.name.trim() === mainName),
    );
    return {
      replace: true as const,
      defaultPreset: defaultPreset < 0 ? 0 : defaultPreset,
      roles: {
        main: roles.main || undefined,
        fast: roles.fast || undefined,
        vision: roles.vision || undefined,
        helper: roles.helper || roles.fast || undefined,
      },
      presets: rows.map((r) => ({
        name: r.name.trim(),
        vendor: r.vendor,
        protocol: r.protocol || "openai",
        url: r.url.trim(),
        urlParams: r.urlParams.trim(),
        model: r.model.trim(),
        key: r.keyEdit.trim() ? r.keyEdit.trim() : "",
        maxContext: r.maxContext,
        maxTokens: r.maxTokens,
        supportsImage: r.supportsImage,
        supportsAudio: r.supportsAudio,
        supportsVideo: r.supportsVideo,
        supportsReasoning: r.supportsReasoning,
        nativeToolCalling: r.nativeToolCalling,
        inputPricePerMt: r.inputPricePerMt,
        outputPricePerMt: r.outputPricePerMt,
        cacheHitPricePerMt: r.cacheHitPricePerMt,
        maxConcurrent: r.maxConcurrent,
        temperature: r.temperature,
        topP: r.topP,
        presencePenalty: r.presencePenalty,
        frequencyPenalty: r.frequencyPenalty,
        customRequestJson: r.customRequestJson,
      })),
    };
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = buildWritePayload();
      const snapCfg = await saveLlmConfig(body);
      applyLlmSnap(snapCfg);
      setRevealKey(false);
      const meta = await fetchMeta();
      const md = await fetchModels(meta.provider || undefined);
      applySnapshot(md.meta.provider ? md.meta : meta, {
        providers: md.providers,
        models: md.models,
      });
      setStatus(`已写入全局配置 · ${snapCfg.configPath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadSvgGallery = useCallback(async () => {
    const model = row?.model?.trim();
    if (!model) {
      setSvgGallery([]);
      setSvgReference(null);
      return;
    }
    try {
      const g = await fetchSvgProbeGallery({
        model,
        presetName: row?.name?.trim() || undefined,
        limit: 12,
      });
      setSvgGallery(g.items);
      setSvgReference(g.reference);
    } catch {
      /* offline */
    }
  }, [row?.model, row?.name]);

  useEffect(() => {
    if (section === "llm") void loadSvgGallery();
  }, [section, loadSvgGallery]);

  /** 对当前编辑中的 preset 发最短 chat，测通 + 延迟 */
  const onTestConnection = async () => {
    if (!row) return;
    setTestBusy(true);
    setTestResult(null);
    setError(null);
    try {
      const keyEdit = (row.keyEdit || "").trim();
      const r = await testLlmConnection({
        name: row.name.trim(),
        url: row.url.trim(),
        model: row.model.trim(),
        // 掩码/空：不传 key，服务端用磁盘已存密钥
        key: keyEdit && !keyEdit.includes("•") ? keyEdit : undefined,
        protocol: row.protocol,
        vendor: row.vendor,
        urlParams: row.urlParams,
        maxTokens: Math.min(row.maxTokens || 32, 32),
        maxContext: row.maxContext || undefined,
        timeoutMs: 30_000,
        probeMessage: "ping",
      });
      setTestResult(r);
      if (r.ok) {
        const fb =
          r.firstByteMs != null ? ` · 首字节 ${r.firstByteMs}ms` : "";
        setStatus(
          `连接成功 · ${r.model} · 延迟 ${r.latencyMs}ms${fb}${
            r.httpStatus != null ? ` · HTTP ${r.httpStatus}` : ""
          }`,
        );
      } else {
        setStatus("");
        setError(
          r.error ||
            `连接失败 · 延迟 ${r.latencyMs}ms${
              r.httpStatus != null ? ` · HTTP ${r.httpStatus}` : ""
            }`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestResult({
        ok: false,
        model: row.model,
        latencyMs: 0,
        error: msg,
      });
      setError(msg);
    } finally {
      setTestBusy(false);
    }
  };

  /** 无上下文 SVG 画图探针 → 画廊（体感模型是否降智/偷换） */
  const onSvgProbe = async () => {
    if (!row) return;
    setSvgProbeBusy(true);
    setSvgProbeMsg("");
    setError(null);
    try {
      const keyEdit = (row.keyEdit || "").trim();
      const r = await runLlmSvgProbe({
        name: row.name.trim(),
        url: row.url.trim(),
        model: row.model.trim(),
        key: keyEdit && !keyEdit.includes("•") ? keyEdit : undefined,
        protocol: row.protocol,
        vendor: row.vendor,
        urlParams: row.urlParams,
        maxTokens: Math.min(Math.max(row.maxTokens || 2048, 1024), 4096),
        subject: svgProbeSubject.trim() || undefined,
        timeoutMs: 90_000,
      });
      if (r.shot) {
        setSvgGallery((prev) => {
          const rest = prev.filter((x) => x.id !== r.shot!.id);
          return [r.shot!, ...rest].slice(0, 12);
        });
      }
      if (r.reference !== undefined) setSvgReference(r.reference ?? null);
      if (r.result?.ok && r.result.extracted) {
        setSvgProbeMsg(
          `✅ 已生成图 · ${r.result.latencyMs}ms · 可与标准参考对比`,
        );
        setStatus(`SVG 探针成功 · ${r.result.model} · ${r.result.latencyMs}ms`);
      } else {
        setSvgProbeMsg(
          r.result?.error || r.error || "未抽出 SVG（可能降智或拒答）",
        );
        setError(r.result?.error || r.error || "SVG 探针失败");
      }
      await loadSvgGallery();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSvgProbeMsg(msg);
      setError(msg);
    } finally {
      setSvgProbeBusy(false);
    }
  };

  const onSetSvgReference = async (shotId: string) => {
    try {
      const ref = await setSvgProbeReference(shotId);
      setSvgReference(ref);
      setSvgProbeMsg("已设为标准参考图（同 model/preset 下次可对比）");
      setStatus("标准参考图已更新");
      await loadSvgGallery();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onAddPreset = () => onAddVendor();

  const onRemovePreset = () => {
    if (rows.length <= 1) {
      setError("至少保留一个模型配置");
      return;
    }
    const removed = rows[selectedSafe]?.name;
    const nextIdx =
      groupModelIndices.length > 1
        ? groupModelIndices.find((i) => i !== selectedSafe) ?? 0
        : Math.max(0, selectedSafe - 1);
    setRows((prev) => prev.filter((_, i) => i !== selectedSafe));
    setSelected(nextIdx > selectedSafe ? nextIdx - 1 : nextIdx);
    setTestResult(null);
    if (removed) {
      setRoles((r) => {
        const next = { ...r };
        for (const k of ["main", "fast", "vision", "helper"] as const) {
          if (next[k] === removed) delete next[k];
        }
        return next;
      });
    }
  };

  const onRemoveVendor = () => {
    if (!activeGroup) return;
    if (rows.length <= activeGroup.indices.length) {
      setError("至少保留一个厂商/模型配置");
      return;
    }
    const removeSet = new Set(activeGroup.indices);
    const removedNames = activeGroup.indices
      .map((i) => rows[i]?.name)
      .filter(Boolean) as string[];
    setRows((prev) => prev.filter((_, i) => !removeSet.has(i)));
    setSelected(0);
    setTestResult(null);
    setRoles((r) => {
      const next = { ...r };
      for (const k of ["main", "fast", "vision", "helper"] as const) {
        if (next[k] && removedNames.includes(next[k]!)) delete next[k];
      }
      return next;
    });
  };

  const onProviderChange = async (provider: string) => {
    if (!provider || provider === snap.provider) return;
    setBusy(true);
    setError(null);
    try {
      const md = await fetchModels(provider);
      const model = resolveModelAfterProviderChange(md.models, snap.model);
      if (!model) {
        setSnap((s) => ({ ...s, provider, models: md.models, model: "" }));
        return;
      }
      const meta = await setModel(provider, model);
      applySnapshot(meta, {
        providers: md.providers.length ? md.providers : snap.providers,
        models: md.models,
      });
      setStatus(`会话已切换 ${provider} · ${model}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onModelChange = async (model: string) => {
    if (!model || model === snap.model || !snap.provider) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await setModel(snap.provider, model);
      applySnapshot(meta, {
        providers: snap.providers,
        models: snap.models,
      });
      setStatus(`会话模型 ${model}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onApprovalChange = async (raw: string) => {
    if (!isApprovalMode(raw) || raw === snap.approvalMode) return;
    const mode: ApprovalMode = raw;
    setBusy(true);
    setError(null);
    try {
      const meta = await setApprovalMode(mode);
      const merged: Meta = {
        ...meta,
        approvalMode: meta.approvalMode || mode,
        sandboxMode: meta.sandboxMode || mode,
      };
      setSnap((s) => withApprovalMode(s, mode));
      onMetaChangeRef.current?.(merged);
      setStatus(`审批模式 → ${mode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isPage = presentation === "page";
  const rootClass = isPage ? "wire-settings-page" : "wire-settings-overlay";

  const roleSelect = (
    roleId: keyof LlmConfigRoles,
    label: string,
    hint: string,
    dataMark?: string,
  ) => (
    <label
      key={roleId}
      className="wire-settings-field"
      data-live-role-field={dataMark || roleId}
    >
      <span className="wire-settings-label">{label}</span>
      <select
        className="wire-settings-input"
        value={roles[roleId] || ""}
        disabled={busy || presetNames.length === 0}
        data-live-role={roleId}
        onChange={(e) =>
          setRoles((r) => ({
            ...r,
            [roleId]: e.target.value || undefined,
          }))
        }
      >
        <option value="">— 未指定（回退默认）—</option>
        {presetNames.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="wire-settings-desc">{hint}</span>
    </label>
  );

  return (
    <div
      className={rootClass}
      role={isPage ? "region" : "dialog"}
      aria-modal={isPage ? undefined : true}
      aria-label="设置"
      data-settings-presentation={presentation}
      data-live-settings="true"
      data-live-settings-section={section}
      data-live-llm-config="true"
    >
      {!isPage ? (
        <button
          type="button"
          className="wire-settings-backdrop"
          aria-label="关闭设置"
          onClick={() => onClose?.()}
        />
      ) : null}
      <div className="wire-settings-panel">
        <header className="wire-settings-head">
          <div className="wire-settings-title-row">
            <UiEmoji name="settings" />
            <h2 className="wire-settings-title">设置</h2>
            <span className="wire-settings-sub">LLM 配置与模板</span>
          </div>
          {onClose ? (
            <button
              type="button"
              className="wire-text-btn wire-settings-close"
              onClick={onClose}
            >
              返回
            </button>
          ) : null}
        </header>

        <div className="wire-settings-body">
          <nav className="wire-settings-nav" aria-label="设置分类">
            {LIVE_SETTINGS_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`wire-settings-nav-item${
                  section === s.id ? " active" : ""
                }`}
                aria-current={section === s.id ? "page" : undefined}
                data-live-settings-nav={s.id}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {/* ── 1. LLM：厂商连接 + 组内多模型 ── */}
          {section === "llm" ? (
            <section
              className="wire-settings-section wire-settings-section-llm"
              data-live-settings-section="llm"
            >
              <div className="wire-settings-section-head compact">
                <h3 className="wire-settings-h">LLM</h3>
                <p className="wire-settings-desc">
                  厂商 preset 内多模型（
                  <code>api.presets[].models[]</code>
                  ）· 连接共用 · 上下文独立 ·{" "}
                  <code>{cfgPath || "config.json"}</code>
                </p>
              </div>
              <div className="wire-settings-api-layout">
                {/* 左：厂商列表 */}
                <aside className="wire-settings-preset-list" role="list">
                  <div className="wire-settings-list-head">
                    <span>厂商</span>
                    <div className="wire-settings-list-actions">
                      <button
                        type="button"
                        className="wire-text-btn"
                        disabled={busy}
                        onClick={onAddVendor}
                      >
                        + 厂商
                      </button>
                      <button
                        type="button"
                        className="wire-text-btn"
                        disabled={busy}
                        onClick={() => void reload()}
                      >
                        刷新
                      </button>
                    </div>
                  </div>
                  {vendorGroups.length === 0 ? (
                    <div className="wire-settings-empty">暂无 · 添加厂商</div>
                  ) : (
                    vendorGroups.map((g) => {
                      const firstIdx = g.indices[0]!;
                      const isSel = g.indices.includes(selectedSafe);
                      const modelCount = g.indices.length;
                      return (
                        <button
                          key={g.key}
                          type="button"
                          role="listitem"
                          className={`wire-settings-preset-item${
                            isSel ? " is-selected" : ""
                          }`}
                          data-live-vendor={g.label}
                          onClick={() => {
                            setSelected(firstIdx);
                            setRevealKey(false);
                            setTestResult(null);
                          }}
                        >
                          <span className="wire-settings-preset-name">
                            {g.label}
                          </span>
                          <span className="wire-settings-preset-meta">
                            {modelCount} 模型 ·{" "}
                            {(rows[firstIdx]?.model || "—").slice(0, 18)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </aside>

                {/* 右：编辑 */}
                <div className="wire-settings-preset-editor">
                  {row && activeGroup ? (
                    <>
                      {/* ── 块：厂商连接 ── */}
                      <div className="wire-settings-card">
                        <div className="wire-settings-card-head">
                          <span className="wire-settings-card-title">
                            厂商连接
                          </span>
                          <span className="wire-settings-card-meta">
                            同组模型共用
                          </span>
                        </div>
                        <div className="wire-settings-card-body">
                          <div className="wire-settings-grid-2">
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                厂商名称
                              </span>
                              <input
                                className="wire-settings-input"
                                value={activeGroup.label}
                                disabled={busy}
                                data-live-vendor-label=""
                                onChange={(e) => {
                                  const label = e.target.value.trim() || "厂商";
                                  const first = activeGroup.indices[0]!;
                                  setRows((prev) => {
                                    const next = [...prev];
                                    if (activeGroup.indices.length === 1) {
                                      next[first] = {
                                        ...next[first]!,
                                        name: label,
                                      };
                                      return next;
                                    }
                                    for (const i of activeGroup.indices) {
                                      const cur = next[i]!;
                                      const suffix =
                                        cur.model?.trim() ||
                                        (cur.name.includes("/")
                                          ? cur.name.split("/").slice(1).join("/")
                                          : cur.name) ||
                                        "model";
                                      next[i] = {
                                        ...cur,
                                        name: `${label}/${suffix}`,
                                      };
                                    }
                                    return next;
                                  });
                                }}
                                title="列表展示名；多模型时预设名为 厂商/模型ID"
                              />
                            </label>
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                协议 / 标准
                              </span>
                              <select
                                className="wire-settings-input"
                                value={row.vendor}
                                disabled={busy}
                                data-live-preset-vendor=""
                                onChange={(e) => onVendorChange(e.target.value)}
                              >
                                {(vendors.length
                                  ? vendors
                                  : [
                                      {
                                        id: "openai",
                                        label: "OpenAI 兼容",
                                        protocol: "openai",
                                        defaultUrl: "",
                                      },
                                      {
                                        id: "custom",
                                        label: "自定义",
                                        protocol: "openai",
                                        defaultUrl: "",
                                      },
                                    ]
                                ).map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <label className="wire-settings-field dense">
                            <span className="wire-settings-label">Base URL</span>
                            <input
                              className="wire-settings-input"
                              value={row.url}
                              disabled={busy}
                              data-live-preset-url=""
                              onChange={(e) =>
                                patchConnection({ url: e.target.value })
                              }
                            />
                          </label>
                          <div className="wire-settings-grid-2">
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                URL 参数
                              </span>
                              <input
                                className="wire-settings-input"
                                value={row.urlParams}
                                disabled={busy}
                                placeholder="可选"
                                data-live-preset-url-params=""
                                onChange={(e) =>
                                  patchConnection({
                                    urlParams: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                API Key{row.hasKey ? " · 已配" : ""}
                              </span>
                              <div className="wire-settings-key-row">
                                <input
                                  className="wire-settings-input"
                                  type={revealKey ? "text" : "password"}
                                  value={
                                    revealKey || row.keyEdit
                                      ? row.keyEdit
                                      : row.keyMasked
                                  }
                                  placeholder={
                                    row.hasKey
                                      ? "留空保留"
                                      : "sk-… / 厂商 key"
                                  }
                                  disabled={busy}
                                  data-live-preset-key=""
                                  onChange={(e) => {
                                    if (e.target.value === row.keyMasked)
                                      return;
                                    patchConnection({
                                      keyEdit: e.target.value,
                                    });
                                  }}
                                />
                                <button
                                  type="button"
                                  className="wire-text-btn"
                                  disabled={busy}
                                  onClick={() => setRevealKey((v) => !v)}
                                >
                                  {revealKey ? "隐" : "编"}
                                </button>
                              </div>
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* ── 块：模型列表 ── */}
                      <div className="wire-settings-card">
                        <div className="wire-settings-card-head">
                          <span className="wire-settings-card-title">
                            模型列表
                          </span>
                          <button
                            type="button"
                            className="wire-text-btn"
                            disabled={busy}
                            onClick={onAddModelInVendor}
                          >
                            + 添加模型
                          </button>
                        </div>
                        <div className="wire-settings-card-body">
                          <div
                            className="wire-settings-model-chips"
                            role="listbox"
                            aria-label="此厂商下的模型"
                          >
                            {groupModelIndices.map((idx) => {
                              const m = rows[idx]!;
                              const on = idx === selectedSafe;
                              return (
                                <button
                                  key={`${m.name}-${idx}`}
                                  type="button"
                                  role="option"
                                  aria-selected={on}
                                  className={`wire-settings-model-chip${
                                    on ? " is-on" : ""
                                  }${roles.main === m.name ? " is-main" : ""}`}
                                  data-live-preset={m.name}
                                  onClick={() => {
                                    setSelected(idx);
                                    setTestResult(null);
                                  }}
                                >
                                  <span className="wire-settings-model-chip-id">
                                    {m.model || "（未命名模型）"}
                                  </span>
                                  <span className="wire-settings-model-chip-meta">
                                    ctx {(m.maxContext / 1000).toFixed(0)}k
                                    {roles.main === m.name ? " · 主" : ""}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* ── 块：当前模型 ── */}
                      <div className="wire-settings-card">
                        <div className="wire-settings-card-head">
                          <span className="wire-settings-card-title">
                            当前模型
                          </span>
                          <span className="wire-settings-card-meta mono">
                            {row.name}
                          </span>
                        </div>
                        <div className="wire-settings-card-body">
                          <div className="wire-settings-grid-2">
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                模型 ID
                              </span>
                              <input
                                className="wire-settings-input"
                                value={row.model}
                                disabled={busy || testBusy}
                                data-live-preset-model=""
                                placeholder="如 deepseek-v4-flash-free"
                                onChange={(e) =>
                                  patchRow({ model: e.target.value })
                                }
                              />
                            </label>
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                预设名（roles 绑定）
                              </span>
                              <input
                                className="wire-settings-input"
                                value={row.name}
                                disabled={busy}
                                onChange={(e) =>
                                  patchRow({ name: e.target.value })
                                }
                              />
                            </label>
                          </div>

                          <div className="wire-settings-grid-2">
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                上下文长度
                              </span>
                              <input
                                className="wire-settings-input"
                                type="number"
                                value={row.maxContext}
                                disabled={busy}
                                onChange={(e) =>
                                  patchRow({
                                    maxContext: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </label>
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                max_tokens
                              </span>
                              <input
                                className="wire-settings-input"
                                type="number"
                                value={row.maxTokens}
                                disabled={busy}
                                onChange={(e) =>
                                  patchRow({
                                    maxTokens: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </label>
                          </div>

                          <div className="wire-settings-test-row">
                            <button
                              type="button"
                              className="wire-settings-test-btn"
                              disabled={
                                busy ||
                                testBusy ||
                                svgProbeBusy ||
                                !row.url.trim() ||
                                !row.model.trim()
                              }
                              onClick={() => void onTestConnection()}
                              title="真实 chat 探测 + 延迟"
                            >
                              <UiEmoji name="plug" />
                              {testBusy ? " 测试中…" : " 测试连接"}
                            </button>
                            {testResult ? (
                              <span
                                className={`wire-settings-test-result${
                                  testResult.ok ? " is-ok" : " is-err"
                                }`}
                                title={
                                  testResult.replyPreview
                                    ? `回复: ${testResult.replyPreview}`
                                    : testResult.error || undefined
                                }
                              >
                                {testResult.ok ? (
                                  <>
                                    <UiEmoji name="ok" />{" "}
                                    {testResult.latencyMs}ms
                                    {testResult.firstByteMs != null
                                      ? ` · TTFB ${testResult.firstByteMs}ms`
                                      : ""}
                                  </>
                                ) : (
                                  <>
                                    <UiEmoji name="fail" />{" "}
                                    {testResult.latencyMs}ms ·{" "}
                                    {testResult.error || "失败"}
                                  </>
                                )}
                              </span>
                            ) : (
                              <span className="wire-settings-test-hint">
                                <UiEmoji name="test" /> chat 探测 · 端到端延迟
                              </span>
                            )}
                          </div>

                          {/* 模型降智体感：无上下文 SVG → 图片画廊 */}
                          <div className="wire-settings-svg-probe">
                            <div className="wire-settings-svg-probe-head">
                              <span className="wire-settings-label">
                                <UiEmoji name="paint" /> 模型画图探针（降智体感）
                              </span>
                              <span className="wire-settings-test-hint">
                                零上下文只输出 SVG → 渲染成图，对比是否被偷换劣质模型
                              </span>
                            </div>
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                自定义画题
                              </span>
                              <input
                                className="wire-settings-input"
                                value={svgProbeSubject}
                                disabled={busy || svgProbeBusy}
                                placeholder="如：一只简笔画小狗站在小舞台上"
                                onChange={(e) =>
                                  setSvgProbeSubject(e.target.value)
                                }
                              />
                            </label>
                            <div className="wire-settings-test-row">
                              <button
                                type="button"
                                className="wire-settings-test-btn wire-settings-test-btn-secondary"
                                disabled={
                                  busy ||
                                  testBusy ||
                                  svgProbeBusy ||
                                  !row.url.trim() ||
                                  !row.model.trim()
                                }
                                onClick={() => void onSvgProbe()}
                                title="无上下文要求模型输出 SVG 并解析成图"
                              >
                                <UiEmoji name="paint" />
                                {svgProbeBusy ? " 画图中…" : " 运行画图探针"}
                              </button>
                              {svgProbeMsg ? (
                                <span
                                  className={`wire-settings-test-result${
                                    svgProbeMsg.startsWith("✓") ||
                                    svgProbeMsg.includes("✅")
                                      ? " is-ok"
                                      : " is-err"
                                  }`}
                                >
                                  {svgProbeMsg}
                                </span>
                              ) : null}
                            </div>

                            {svgReference?.imageDataUrl ? (
                              <div className="wire-settings-svg-ref">
                                <div className="wire-settings-svg-ref-label">
                                  <UiEmoji name="star" /> 标准参考
                                  <span className="wire-settings-test-hint">
                                    {" "}
                                    <UiEmoji name="clock" />{" "}
                                    {svgReference.createdAt
                                      ? new Date(
                                          svgReference.createdAt,
                                        ).toLocaleString()
                                      : ""}
                                  </span>
                                </div>
                                <img
                                  className="wire-settings-svg-thumb wire-settings-svg-thumb-ref"
                                  src={svgReference.imageDataUrl}
                                  alt="标准参考图"
                                />
                              </div>
                            ) : (
                              <p className="wire-settings-test-hint">
                                尚未设置标准参考：跑出满意结果后点「设为标准参考」
                              </p>
                            )}

                            <div className="wire-settings-svg-gallery">
                              {svgGallery.length === 0 ? (
                                <p className="wire-settings-test-hint">
                                  <UiEmoji name="gallery" /> 画廊为空 · 点「运行画图探针」开始
                                </p>
                              ) : (
                                svgGallery.map((it) => (
                                  <div
                                    key={it.id}
                                    className={`wire-settings-svg-card${
                                      it.ok && it.extracted ? "" : " is-bad"
                                    }`}
                                  >
                                    {it.imageDataUrl ? (
                                      <img
                                        className="wire-settings-svg-thumb"
                                        src={it.imageDataUrl}
                                        alt={it.subject}
                                      />
                                    ) : (
                                      <div className="wire-settings-svg-thumb wire-settings-svg-thumb-empty">
                                        <UiEmoji name="fail" /> 无图
                                      </div>
                                    )}
                                    <div className="wire-settings-svg-card-meta">
                                      <time dateTime={it.createdAt}>
                                        <UiEmoji name="clock" />{" "}
                                        {new Date(
                                          it.createdAt,
                                        ).toLocaleString()}
                                      </time>
                                      <span>
                                        {it.latencyMs}ms
                                        {it.ok && it.extracted ? (
                                          <>
                                            {" "}
                                            · <UiEmoji name="ok" />
                                          </>
                                        ) : (
                                          <>
                                            {" "}
                                            · <UiEmoji name="fail" />
                                          </>
                                        )}
                                      </span>
                                      {it.imageDataUrl ? (
                                        <button
                                          type="button"
                                          className="wire-settings-svg-ref-btn"
                                          disabled={busy || svgProbeBusy}
                                          onClick={() =>
                                            void onSetSvgReference(it.id)
                                          }
                                          title="将该图设为对比标准"
                                        >
                                          <UiEmoji name="pin" /> 设为标准参考
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="wire-settings-caps dense">
                            {(
                              [
                                ["supportsImage", "图片"],
                                ["supportsAudio", "音频"],
                                ["supportsVideo", "视频"],
                                ["supportsReasoning", "推理"],
                                ["nativeToolCalling", "工具"],
                              ] as const
                            ).map(([key, lab]) => (
                              <label key={key} className="proactive-check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row[key])}
                                  disabled={busy}
                                  onChange={(e) =>
                                    patchRow({
                                      [key]: e.target.checked,
                                    } as Partial<DraftRow>)
                                  }
                                />
                                <span>{lab}</span>
                              </label>
                            ))}
                          </div>

                          <div className="wire-settings-grid-3">
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                输入 $/1M
                              </span>
                              <input
                                className="wire-settings-input"
                                value={row.inputPricePerMt}
                                placeholder="—"
                                disabled={busy}
                                onChange={(e) =>
                                  patchRow({
                                    inputPricePerMt: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                输出 $/1M
                              </span>
                              <input
                                className="wire-settings-input"
                                value={row.outputPricePerMt}
                                placeholder="—"
                                disabled={busy}
                                onChange={(e) =>
                                  patchRow({
                                    outputPricePerMt: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="wire-settings-field dense">
                              <span className="wire-settings-label">
                                并发
                              </span>
                              <input
                                className="wire-settings-input"
                                value={row.maxConcurrent}
                                placeholder="0"
                                disabled={busy}
                                onChange={(e) =>
                                  patchRow({
                                    maxConcurrent: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>

                          <button
                            type="button"
                            className="wire-text-btn wire-settings-adv-toggle"
                            disabled={busy}
                            onClick={() =>
                              patchRow({ showAdvanced: !row.showAdvanced })
                            }
                          >
                            {row.showAdvanced
                              ? "▾ 采样 / extraBody"
                              : "▸ 采样 / extraBody"}
                          </button>

                          {row.showAdvanced ? (
                            <div className="wire-settings-advanced">
                              <div className="wire-settings-grid-2">
                                <label className="wire-settings-field dense">
                                  <span className="wire-settings-label">
                                    temperature
                                  </span>
                                  <input
                                    className="wire-settings-input"
                                    value={row.temperature}
                                    disabled={busy}
                                    onChange={(e) =>
                                      patchRow({
                                        temperature: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="wire-settings-field dense">
                                  <span className="wire-settings-label">
                                    top_p
                                  </span>
                                  <input
                                    className="wire-settings-input"
                                    value={row.topP}
                                    disabled={busy}
                                    onChange={(e) =>
                                      patchRow({ topP: e.target.value })
                                    }
                                  />
                                </label>
                              </div>
                              <label className="wire-settings-field dense">
                                <span className="wire-settings-label">
                                  extraBody JSON
                                </span>
                                <textarea
                                  className="wire-settings-input wire-settings-textarea"
                                  rows={3}
                                  value={row.customRequestJson}
                                  disabled={busy}
                                  onChange={(e) =>
                                    patchRow({
                                      customRequestJson: e.target.value,
                                    })
                                  }
                                />
                              </label>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="wire-settings-footer-actions">
                        <button
                          type="button"
                          className="wire-settings-save-btn"
                          disabled={busy}
                          data-live-config-save=""
                          onClick={() => void onSave()}
                        >
                          保存全部
                        </button>
                        <button
                          type="button"
                          className="wire-text-btn"
                          disabled={busy || groupModelIndices.length < 1}
                          onClick={onRemovePreset}
                        >
                          删除此模型
                        </button>
                        <button
                          type="button"
                          className="wire-text-btn"
                          disabled={
                            busy ||
                            rows.length <= groupModelIndices.length
                          }
                          onClick={onRemoveVendor}
                        >
                          删除厂商
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="wire-settings-empty">选择或添加厂商</p>
                  )}

                  {error ? (
                    <p className="wire-settings-error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  {status && !error ? (
                    <p className="wire-settings-status" role="status">
                      {busy || testBusy ? "…" : status}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* ── 置顶合一：Agent 方案 + 模板默认 + 终端审批 ── */}
          {section === "runtime_defaults" ? (
            <section
              className="wire-settings-section"
              data-live-settings-section="runtime_defaults"
              data-live-settings-section-agent="true"
              data-live-settings-section-template="true"
              data-live-settings-section-approval="true"
            >
              <div className="wire-settings-section-head">
                <h3 className="wire-settings-h">方案与审批</h3>
                <p className="wire-settings-desc">
                  合一界面（置顶）：Agent 模型方案 = 模板默认（
                  <code>api.roles</code>
                  ）+ 终端审批。多模态辅助在主模型无对应能力时作转译。
                </p>
              </div>

              <div className="wire-settings-preset-editor wire-settings-combined">
                <h4 className="wire-settings-h" data-live-block="roles">
                  模型方案 · 模板默认
                </h4>
                <p className="wire-settings-desc">
                  主 / 小 / 多模态 → 全局默认；coding 等模板未单独指定时沿用。
                </p>
                {roleSelect(
                  "main",
                  "主模型",
                  "主对话 / agent loop · 模板默认主模型",
                  "role-main",
                )}
                {roleSelect(
                  "fast",
                  "小模型",
                  "压缩 / 分类 / 轻量判定 · 模板默认小模型",
                  "role-fast",
                )}
                {roleSelect(
                  "vision",
                  "多模态辅助模型",
                  "主模型缺图/音/视频时转译 · 模板默认多模态",
                  "role-vision",
                )}
                <div
                  className="wire-settings-template-summary"
                  data-live-template-summary=""
                >
                  <p className="wire-settings-desc">
                    当前：主=
                    <strong data-live-role-value="main">
                      {roles.main || "—"}
                    </strong>{" "}
                    · 小=
                    <strong data-live-role-value="fast">
                      {roles.fast || "—"}
                    </strong>{" "}
                    · 多模态=
                    <strong data-live-role-value="vision">
                      {roles.vision || "—"}
                    </strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="wire-text-btn on"
                  disabled={busy}
                  data-live-config-save=""
                  onClick={() => void onSave()}
                >
                  保存模型方案
                </button>

                <hr className="wire-settings-sep" />
                <h4 className="wire-settings-h" data-live-block="approval">
                  终端审批
                </h4>
                <p className="wire-settings-desc">
                  <code>POST /api/approval</code> · normal / auto / yolo
                </p>
                <label className="wire-settings-field">
                  <span className="wire-settings-label">模式</span>
                  <select
                    className="wire-settings-input"
                    value={
                      isApprovalMode(snap.approvalMode)
                        ? snap.approvalMode
                        : "yolo"
                    }
                    disabled={busy || snap.offline}
                    data-live-approval-select=""
                    onChange={(e) => void onApprovalChange(e.target.value)}
                  >
                    {APPROVAL_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m} — {approvalModeLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="wire-settings-approval-modes">
                  {APPROVAL_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`wire-settings-preset-item${
                        snap.approvalMode === m ? " is-selected is-default" : ""
                      }`}
                      data-live-approval-mode={m}
                      disabled={busy || snap.offline}
                      onClick={() => void onApprovalChange(m)}
                    >
                      <span className="wire-settings-preset-name">{m}</span>
                      <span className="wire-settings-preset-meta">
                        {approvalModeLabel(m)}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="wire-settings-desc">
                  {approvalModeHint(
                    isApprovalMode(snap.approvalMode)
                      ? snap.approvalMode
                      : "yolo",
                  )}
                </p>

                <hr className="wire-settings-sep" />
                <h4 className="wire-settings-h">本会话当前模型</h4>
                <p className="wire-settings-desc">
                  仅切换 Web 会话（不改 roles / config 默认）。
                </p>
                <label className="wire-settings-field">
                  <span className="wire-settings-label">Provider</span>
                  <select
                    className="wire-settings-input"
                    value={snap.provider}
                    disabled={busy || snap.providers.length === 0}
                    data-live-provider-select=""
                    onChange={(e) => void onProviderChange(e.target.value)}
                  >
                    {snap.providers.length === 0 ? (
                      <option value="">—</option>
                    ) : (
                      snap.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="wire-settings-field">
                  <span className="wire-settings-label">Model</span>
                  <select
                    className="wire-settings-input"
                    value={snap.model}
                    disabled={busy || snap.models.length === 0}
                    data-live-model-select=""
                    onChange={(e) => void onModelChange(e.target.value)}
                  >
                    {snap.models.length === 0 ? (
                      <option value="">—</option>
                    ) : (
                      snap.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.id}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                {error ? (
                  <p className="wire-settings-error" role="alert">
                    {error}
                  </p>
                ) : null}
                {status && !error ? (
                  <p className="wire-settings-status">{status}</p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
