/**
 * 共用省略尺：精确数量或 unknown，不编数字。
 *
 * 截断只说"省了多少"是死路 —— 模型没有下一步动作可做。
 * locator（全文在哪）与 retrieveHint（怎么取回）是出路，能给就必须给。
 */

export type OmissionUnit = "chars" | "bytes" | "lines" | "code_points";

export type Omission =
  | { kind: "none" }
  | { kind: "exact"; count: number; unit: OmissionUnit }
  | { kind: "unknown"; unit: OmissionUnit };

export type RetentionNotice = {
  omitted: Omission;
  keptHead: number;
  keptTail: number;
  marker: string;
  locator?: string;
  retrieveHint?: string;
  text: string;
};

export const TOOL_RESULT_OMIT_MARKER = "\n\n[... tool result middle pruned ...]\n\n";

export function describeOmitted(omitted: Omission): string {
  if (omitted.kind === "none") return "";
  const unit = unitLabel(omitted.unit);
  if (omitted.kind === "unknown") return `More ${unit} were omitted.`;
  return `Omitted ${omitted.count} ${unit}.`;
}

export function formatRetentionNotice(
  omitted: Omission,
  opts?: { retrieveHint?: string; locator?: string },
): string {
  const head = describeOmitted(omitted);
  const loc = opts?.locator ? ` Full output saved to: ${opts.locator}.` : "";
  const hint = opts?.retrieveHint ? ` ${opts.retrieveHint}` : "";
  return `(${head}${loc}${hint})`.replace("()", "").trim();
}

export function omissionFromCounts(opts: {
  original: number;
  keptHead: number;
  keptTail: number;
  unit?: OmissionUnit;
}): Omission {
  const omitted = opts.original - opts.keptHead - opts.keptTail;
  if (omitted <= 0) return { kind: "none" };
  return { kind: "exact", count: omitted, unit: opts.unit ?? "chars" };
}

export function buildRetentionNotice(opts: {
  original: number;
  keptHead: number;
  keptTail: number;
  unit?: OmissionUnit;
  marker?: string;
  locator?: string;
  retrieveHint?: string;
}): RetentionNotice {
  const omitted = omissionFromCounts(opts);
  const marker = opts.marker ?? TOOL_RESULT_OMIT_MARKER;
  const text =
    omitted.kind === "none"
      ? ""
      : `${marker.trim()}\n${formatRetentionNotice(omitted, {
          locator: opts.locator,
          retrieveHint: opts.retrieveHint,
        })}`;
  return {
    omitted,
    keptHead: opts.keptHead,
    keptTail: opts.keptTail,
    marker,
    locator: opts.locator,
    retrieveHint: opts.retrieveHint,
    text,
  };
}

/**
 * 全文落在磁盘上时的标准出路文案。
 * 说清用哪个工具、给什么参数，模型才有下一步可走。
 */
export function spillRetrieveHint(opts?: { unit?: OmissionUnit }): string {
  const unit = opts?.unit === "lines" ? "offset / limit" : "offset";
  return `Read that file with the read tool (${unit}) to get the omitted part.`;
}

function unitLabel(unit: OmissionUnit): string {
  switch (unit) {
    case "bytes":
      return "bytes";
    case "lines":
      return "lines";
    case "code_points":
      return "code points";
    default:
      return "chars";
  }
}
