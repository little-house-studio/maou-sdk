/**
 * 子→父汇报桥：安静注入 + 可选 inbox 投递（由 runtime 绑定）。
 */

import { formatSenderEnvelope } from "@little-house-studio/types";

export type QuietReport = {
  fromSessionId: string;
  fromAgent?: string;
  message: string;
  at: number;
};

export type ReportWakeFn = (
  parentSessionId: string,
  message: string,
  fromSessionId: string,
  fromAgent?: string,
) => void;

const quiet = new Map<string, QuietReport[]>();
let wakeFn: ReportWakeFn | null = null;

export function bindReportWake(fn: ReportWakeFn | null): void {
  wakeFn = fn;
}

export function wakeParent(
  parentSessionId: string,
  message: string,
  fromSessionId: string,
  fromAgent?: string,
): boolean {
  if (!wakeFn) return false;
  wakeFn(parentSessionId, message, fromSessionId, fromAgent);
  return true;
}

export function pushQuietReport(parentSessionId: string, report: QuietReport): void {
  const list = quiet.get(parentSessionId) ?? [];
  list.push(report);
  quiet.set(parentSessionId, list);
}

export function takeQuietReports(parentSessionId: string): QuietReport[] {
  const list = quiet.get(parentSessionId) ?? [];
  quiet.delete(parentSessionId);
  return list;
}

export function resetQuietReportsForTest(): void {
  quiet.clear();
}

export function formatQuietReports(reports: QuietReport[]): string {
  if (!reports.length) return "";
  return reports
    .map((r) =>
      formatSenderEnvelope({
        body: r.message,
        from: r.fromAgent?.trim() || r.fromSessionId,
        type: "report",
      }),
    )
    .join("\n");
}
