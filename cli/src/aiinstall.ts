#!/usr/bin/env node
import { runAiinstallMain } from "@little-house-studio/install-agent";

runAiinstallMain({ argv: process.argv.slice(2) })
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
