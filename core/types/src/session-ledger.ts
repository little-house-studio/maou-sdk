/**
 * 会话账本端口（Session Ledger）
 *
 * 给工具 / runtime 用的最小契约。实现在 @little-house-studio/context，
 * 经 ToolRuntimePorts.sessionLedger 注入。tools 不得 import context。
 *
 * 新功能接入：registerLedgerEvent({ type, surface }) + append(type, data)。
 * 不必再手写落盘、查询或模型工具。
 */

/** log=仅审计；model=模型可查；ui=给人看的旁路（默认不进模型 query） */
export type SessionLedgerSurface = "log" | "model" | "ui";

export interface SessionLedgerEvent {
  seq: number;
  type: string;
  ts: string;
  sessionId: string;
  surface: SessionLedgerSurface;
  data: Record<string, unknown>;
  messageId?: string;
  summary?: string;
}

export interface SessionLedgerCatalogEntry {
  type: string;
  surface: SessionLedgerSurface;
  description?: string;
  ignorable?: boolean;
}

export interface SessionLedgerQuery {
  types?: string[];
  sinceSeq?: number;
  untilSeq?: number;
  q?: string;
  limit?: number;
  offset?: number;
  /** 缺省 all；模型面查询默认只看 model */
  surface?: SessionLedgerSurface | "all";
}

export interface SessionLedgerAppendOpts {
  /** 覆盖目录登记的 surface（少用） */
  surface?: SessionLedgerSurface;
  messageId?: string;
}

export interface SessionLedgerPort {
  append(
    eventType: string,
    data: Record<string, unknown>,
    opts?: SessionLedgerAppendOpts,
  ): { seq: number } | { error: string };
  query(filter?: SessionLedgerQuery): {
    events: SessionLedgerEvent[];
    total: number;
    catalog: SessionLedgerCatalogEntry[];
  };
  catalog(): SessionLedgerCatalogEntry[];
}
