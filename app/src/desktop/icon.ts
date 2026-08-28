import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** App icon on disk. Dev: app/resources. Packaged: next to asar / extra files. */
export function resolveAppIcon(
  here = dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  const candidates = [
    join(here, "../../resources/icon.png"),
    join(process.cwd(), "resources/icon.png"),
    join(process.resourcesPath ?? "", "icon.png"),
  ];
  return candidates.find((p) => p && existsSync(p));
}
