/**
 * 按包装的运行时契约。报错带包名；部署可用正则放行或拦住。
 */

export type RuntimeContract = {
  package: string;
  name: string;
  check: () => { ok: boolean; message?: string } | Promise<{ ok: boolean; message?: string }>;
  diagnose?: () => string;
};

export type ContractReport = {
  package: string;
  name: string;
  ok: boolean;
  message?: string;
  diagnose?: string;
  skipped?: boolean;
};

const contracts: RuntimeContract[] = [];

export function registerContract(spec: RuntimeContract): void {
  const key = `${spec.package}/${spec.name}`;
  const idx = contracts.findIndex((c) => `${c.package}/${c.name}` === key);
  if (idx >= 0) contracts[idx] = spec;
  else contracts.push(spec);
}

export function listContracts(): RuntimeContract[] {
  return [...contracts];
}

export function resetContractsForTest(): void {
  contracts.length = 0;
}

function compileEnvRe(raw: string | undefined): RegExp | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  try {
    return new RegExp(t);
  } catch {
    return null;
  }
}

export function contractFilters(env: NodeJS.ProcessEnv = process.env): {
  allow: RegExp | null;
  deny: RegExp | null;
} {
  return {
    allow: compileEnvRe(env.MAOU_CONTRACT_ALLOW),
    deny: compileEnvRe(env.MAOU_CONTRACT_DENY),
  };
}

export function contractKey(spec: { package: string; name: string }): string {
  return `${spec.package}/${spec.name}`;
}

export async function runContracts(
  opts?: { allow?: RegExp | null; deny?: RegExp | null; env?: NodeJS.ProcessEnv },
): Promise<ContractReport[]> {
  const filters = opts?.allow !== undefined || opts?.deny !== undefined
    ? { allow: opts.allow ?? null, deny: opts.deny ?? null }
    : contractFilters(opts?.env);
  const out: ContractReport[] = [];
  for (const spec of contracts) {
    const key = contractKey(spec);
    if (filters.allow && !filters.allow.test(key)) {
      out.push({ package: spec.package, name: spec.name, ok: true, skipped: true, message: "allow filter" });
      continue;
    }
    if (filters.deny && filters.deny.test(key)) {
      out.push({ package: spec.package, name: spec.name, ok: true, skipped: true, message: "deny filter" });
      continue;
    }
    try {
      const r = await spec.check();
      out.push({
        package: spec.package,
        name: spec.name,
        ok: r.ok,
        message: r.message,
        diagnose: spec.diagnose?.(),
      });
    } catch (err) {
      out.push({
        package: spec.package,
        name: spec.name,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        diagnose: spec.diagnose?.(),
      });
    }
  }
  return out;
}

export function formatContractFailure(report: ContractReport): string {
  return `[${report.package}/${report.name}] ${report.message ?? "contract failed"}`;
}
