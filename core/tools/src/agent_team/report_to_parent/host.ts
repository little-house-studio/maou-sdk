/**
 * 子→父汇报桥：安静注入 + 可选 inbox 投递（由 runtime 绑定）。
 */

export type QuietReport = {
  fromSessionId: string;
  message: string;
  at: number;
};

export type ReportWakeFn = (parentSessionId: string, message: string, fromSessionId: string) => void;

const quiet = new Map<string, QuietReport[]>();
let wakeFn: ReportWakeFn | null = null;

export function bindReportWake(fn: ReportWakeFn | null): void {
  wakeFn = fn;
}

export function wakeParent(parentSessionId: string, message: string, fromSessionId: string): boolean {
  if (!wakeFn) return false;
  wakeFn(parentSessionId, message, fromSessionId);
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
  const lines = reports.map((r) => `- ${r.fromSessionId}: ${r.message}`);
  return `<subagent_report>\n${lines.join("\n")}\n</subagent_report>`;
}
