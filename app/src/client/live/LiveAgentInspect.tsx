/**
 * 右栏：当前 Agent 的 resolveAgentConfig 参数 + preview 系统提示词。
 */
import React, { useEffect, useState } from "react";
import { fetchAgentInspect, type AgentInspectSnapshot } from "../api";

export type LiveAgentInspectProps = {
  switchId?: string;
};

const PARAM_ROWS: Array<{
  key: keyof AgentInspectSnapshot["params"];
  label: string;
  format?: (v: unknown) => string;
}> = [
  { key: "displayName", label: "显示名" },
  { key: "name", label: "name" },
  { key: "role", label: "role" },
  { key: "scope", label: "scope" },
  { key: "roundLimit", label: "round_limit" },
  { key: "maxRetries", label: "max_retries" },
  { key: "terminalMode", label: "terminal_mode" },
  { key: "toolCompression", label: "tool_compression" },
  { key: "thinkingContextMode", label: "thinking_context_mode" },
  { key: "thinkingLevel", label: "thinking_level" },
  {
    key: "workspaceInstructions",
    label: "workspace_instructions",
    format: (v) => (v === true ? "true" : v === false ? "false" : ""),
  },
  { key: "mcpToolStrategy", label: "mcp_tool_strategy" },
  { key: "workingDir", label: "working_dir" },
  {
    key: "tools",
    label: "tools",
    format: (v) => (Array.isArray(v) ? v.join(", ") : ""),
  },
];

export function inspectParamRows(
  params: AgentInspectSnapshot["params"],
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (const row of PARAM_ROWS) {
    const raw = params[row.key];
    if (raw === undefined) continue;
    const value = row.format ? row.format(raw) : String(raw);
    if (!value) continue;
    rows.push({ label: row.label, value });
  }
  return rows;
}

export function LiveAgentInspect({ switchId }: LiveAgentInspectProps) {
  const [data, setData] = useState<AgentInspectSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAgentInspect(switchId || undefined)
      .then((snap) => {
        if (cancelled) return;
        setData(snap);
        setErr(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [switchId]);

  const rows = data ? inspectParamRows(data.params) : [];
  const title = data?.params.displayName || data?.agentName || "Agent";

  return (
    <div className="live-agent-inspect" data-live-agent-inspect="true">
      <div className="live-agent-inspect-head">
        <span className="live-agent-inspect-title">{title}</span>
        {data?.switchId ? (
          <span className="live-agent-inspect-id" title={data.switchId}>
            {data.switchId}
          </span>
        ) : null}
      </div>
      {err ? (
        <div className="live-files-err" title={err}>
          {err}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <dl className="live-agent-inspect-params">
          {rows.map((r) => (
            <div key={r.label} className="live-agent-inspect-row">
              <dt>{r.label}</dt>
              <dd title={r.value}>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="live-agent-inspect-prompt-head">
        系统提示词
        {data?.prompt ? (
          <span>
            {data.prompt.charCount} 字 · {data.prompt.lineCount} 行
          </span>
        ) : null}
      </div>
      {data?.prompt.error && !data.prompt.ok ? (
        <div className="live-files-err" title={data.prompt.error}>
          {data.prompt.error}
        </div>
      ) : (
        <pre className="live-agent-inspect-prompt">{data?.prompt.text ?? ""}</pre>
      )}
    </div>
  );
}
