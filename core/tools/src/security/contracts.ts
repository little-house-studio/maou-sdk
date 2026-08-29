import { registerContract } from "@little-house-studio/types";
import { detectCageBackend } from "./os-cage.js";

let installed = false;

export function installToolsContracts(): void {
  if (installed) return;
  installed = true;
  registerContract({
    package: "@little-house-studio/tools",
    name: "cage-probe",
    check: () => {
      const backend = detectCageBackend();
      return { ok: true, message: backend ?? "unavailable" };
    },
    diagnose: () => `platform=${process.platform} backend=${detectCageBackend() ?? "none"}`,
  });
}
