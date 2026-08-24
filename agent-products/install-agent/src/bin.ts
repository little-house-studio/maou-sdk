#!/usr/bin/env node
import { runAiinstallMain } from "./main.js";

runAiinstallMain({ argv: process.argv.slice(2) })
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
