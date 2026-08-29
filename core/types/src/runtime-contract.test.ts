import { afterEach, describe, expect, it } from "vitest";
import {
  formatContractFailure,
  registerContract,
  resetContractsForTest,
  runContracts,
} from "./runtime-contract.js";

afterEach(() => {
  resetContractsForTest();
});

describe("runtime-contract", () => {
  it("failures carry the package name", async () => {
    registerContract({
      package: "@little-house-studio/context",
      name: "ledger-fsync",
      check: () => ({ ok: false, message: "fsync missing" }),
    });
    const reports = await runContracts({ allow: null, deny: null });
    expect(reports[0]?.ok).toBe(false);
    expect(formatContractFailure(reports[0]!)).toContain("@little-house-studio/context/ledger-fsync");
  });

  it("DENY regex skips a check", async () => {
    registerContract({
      package: "@little-house-studio/tools",
      name: "cage-probe",
      check: () => ({ ok: false, message: "should skip" }),
    });
    const reports = await runContracts({ deny: /tools\/cage/ });
    expect(reports[0]?.skipped).toBe(true);
    expect(reports[0]?.ok).toBe(true);
  });
});
