import { isLedgerEventType, installCoreLedgerCatalog } from "./session-ledger.js";
import { registerContract } from "@little-house-studio/types";

let installed = false;

export function installContextContracts(): void {
  if (installed) return;
  installed = true;
  registerContract({
    package: "@little-house-studio/context",
    name: "ledger-catalog",
    check: () => {
      installCoreLedgerCatalog();
      return {
        ok: isLedgerEventType("user/message") && isLedgerEventType("inbox/enqueue"),
        message: "ledger catalog ready",
      };
    },
  });
}
