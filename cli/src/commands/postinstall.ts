#!/usr/bin/env node
/**
 * npm/pnpm postinstall 入口：检查并尽量补齐依赖。
 * 失败不抛错，避免阻断 install。
 */
import { runPostinstallCheck } from "./deps-check.js";

runPostinstallCheck().catch(() => {
  /* never fail install */
});
