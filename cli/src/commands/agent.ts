/**
 * maou <product> —— 在当前项目目录启动指定 agent 产品 TUI。
 *
 * 入口示例：
 *   maou coding          编程 agent（主产品）
 *   maou agent           coding 兼容别名
 *   maou                 默认 coding
 *   maou ./my-cli.ts     自定义配置路径
 *
 * 启动顺序：
 *   0. 依赖预检 / 自动补齐
 *   1. 系列首次 → maou setup（全局 API）
 *   2. 新路径 → 项目确认（创建 .maou）
 *   3. 进入 TUI
 */

import React from "react";
import { render } from "ink";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentCliConfig } from "../types.js";
import { ensureApiConfigured } from "./setup.js";
import { ensureDependencies } from "./deps-check.js";
import { ensureProjectConsent } from "./project-gate.js";
import { resolveProduct, type MaouProduct } from "./products.js";

export interface AgentLaunchOptions {
  /**
   * 产品名（如 coding）。与 configTarget 二选一；
   * 都不传时默认 coding。
   */
  product?: string;
  /** 自定义 agent cli-config 路径 / 包名；优先于 product */
  configTarget?: string;
  themePath?: string;
  /** 跳过 API 门禁（仅测试） */
  skipSetup?: boolean;
  /** 跳过依赖预检 */
  skipDeps?: boolean;
  /** 跳过新项目确认 */
  skipProjectGate?: boolean;
  /** 新项目非交互确认 */
  yes?: boolean;
}

async function loadConfigFromPath(target: string): Promise<AgentCliConfig> {
  const abs = resolve(target);
  let importPath = abs;
  if (!existsSync(abs) || abs.endsWith("/")) {
    for (const n of ["cli.ts", "index.ts", "agent-cli.ts", "cli-config.ts"]) {
      const c = `${abs}/${n}`;
      if (existsSync(c)) {
        importPath = c;
        break;
      }
    }
    if (importPath === abs) {
      const mod = await import(target);
      return (mod.default ?? mod) as AgentCliConfig;
    }
  }
  const mod = await import(importPath);
  const cfg = (mod.default ?? mod) as AgentCliConfig;
  if (!cfg?.createAgent) {
    throw new Error(`${importPath} 缺少 createAgent`);
  }
  return cfg;
}

async function resolveLaunchConfig(
  opts: AgentLaunchOptions,
): Promise<{ config: AgentCliConfig; product: MaouProduct }> {
  const productName = opts.product ?? "coding";
  const product = resolveProduct(productName);
  if (!product) {
    throw new Error(
      `未知产品「${productName}」。运行 maou --help 查看可用产品。`,
    );
  }

  if (opts.configTarget) {
    return {
      config: await loadConfigFromPath(opts.configTarget),
      product,
    };
  }

  return {
    config: await product.loadConfig(),
    product,
  };
}

/** 启动 Ink TUI（需先装好 exit guard / console 重定向） */
export async function launchAgent(opts: AgentLaunchOptions = {}): Promise<void> {
  // 0) 依赖
  if (!opts.skipDeps && process.env.MAOU_SKIP_DEPS !== "1") {
    const dep = await ensureDependencies({ autoInstall: true });
    if (!dep.ok) {
      process.stderr.write(
        "❌ 核心依赖未就绪，无法启动。请运行：maou doctor\n" +
          dep.errors.map((e) => `   - ${e}`).join("\n") +
          "\n",
      );
      process.exit(1);
    }
    if (dep.missingOptional.length > 0) {
      process.stderr.write(
        `△ 可选依赖缺失（部分功能可能不可用）: ${dep.missingOptional.join(", ")}\n` +
          `  运行 maou doctor 可尝试自动安装。\n`,
      );
    }
  }

  // 1) 系列首次 → 全局 API setup
  if (!opts.skipSetup) {
    const ok = await ensureApiConfigured();
    if (!ok) {
      process.stderr.write(
        "❌ 全局 API 未配置。请运行：maou setup\n" +
          "   或设置 MAOU_API_KEY / OPENAI_API_KEY 后：maou setup --from-env\n",
      );
      process.exit(1);
    }
  }

  const { config, product } = await resolveLaunchConfig(opts);

  // 2) 新项目确认（product 写入 .maou/project.json）
  if (!opts.skipProjectGate && process.env.MAOU_SKIP_PROJECT_GATE !== "1") {
    const ok = await ensureProjectConsent({
      yes: opts.yes,
      product: product.productId,
    });
    if (!ok) {
      process.exit(1);
    }
  }

  const themePath = opts.themePath;

  // 画廊：catalog / 源图变更时自动重烘焙 ASCII（用户自定义友好）
  try {
    const { syncGalleryOnStartup } = await import("../gallery/sync-gallery.js");
    const g = syncGalleryOnStartup({
      log: (m) => process.stderr.write(`  ${m}\n`),
    });
    if (g.rebuilt.length > 0) {
      process.stderr.write(
        `✓ 画廊已更新：${g.rebuilt.join(", ")}\n`,
      );
    }
    if (g.errors.length > 0) {
      process.stderr.write(
        `△ 画廊烘焙警告：${g.errors.slice(0, 3).join(" | ")}\n`,
      );
    }
  } catch (e) {
    process.stderr.write(
      `△ 画廊同步跳过：${e instanceof Error ? e.message : String(e)}\n`,
    );
  }

  const { autoEnablePerfFromEnv, perfInc } = await import("../hooks/perf.js");
  autoEnablePerfFromEnv();
  const { noteInkFrame } = await import("../hooks/process-stats.js");
  // 帧率 A/B：MAOU_LITE=1 时关掉动画/hover/历史窗等（见 config/lite-mode.ts）
  const { isLiteMode, liteModeBanner, liteModeToast } = await import("../config/lite-mode.js");
  if (isLiteMode()) {
    process.stderr.write(`${liteModeBanner()}\n`);
  }

  const {
    initVramLayer,
    createFakeStdout,
    setThemeBg,
    scheduleFullPaint,
    invalidatePaintCache,
    requestScreenRefresh,
  } = await import("../render/vram-layer.js");
  await initVramLayer();

  const { resolveThemeArg, setActiveTheme } = await import("../theme/load-theme.js");
  const loaded = resolveThemeArg(themePath);
  setActiveTheme(loaded, false);
  setThemeBg(loaded.tokens.bg);

  const fakeStdout = createFakeStdout();
  process.stdout.write(
    "\x1b[?1049h\x1b[H\x1b[2J\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?25l",
  );

  const scheduleRender = () => {
    perfInc("inkRender");
    noteInkFrame();
    scheduleFullPaint();
  };

  const { setInkStdoutForResize, syncTerminalSize } = await import(
    "../hooks/useTerminalSize.js"
  );
  setInkStdoutForResize(fakeStdout);

  const { App } = await import("../app.js");
  const { createFilteredStdin } = await import("../input/filtered-stdin.js");
  const filteredStdin =
    process.env.MAOU_NO_FILTER === "1"
      ? process.stdin
      : createFilteredStdin(process.stdin);

  // Ink 默认 maxFps=30。目标滚动 ~25fps：用 40 留余量即可。
  // 过高（60）会导致 ink 堆积、paint 跟不上（见 dump: ink23/pnt15）。
  // MAOU_INK_MAX_FPS 可覆盖；0 = Ink 默认 30。
  const inkMaxFps = (() => {
    const raw = process.env.MAOU_INK_MAX_FPS;
    if (raw === "0" || raw === "default") return 30;
    if (raw != null && raw !== "") {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return Math.min(120, Math.round(n));
    }
    return 40;
  })();

  const { waitUntilExit } = render(
    React.createElement(App, { config, themePath }),
    {
      exitOnCtrlC: false,
      stdin: filteredStdin as NodeJS.ReadStream,
      stdout: fakeStdout as any,
      patchConsole: false,
      onRender: scheduleRender,
      maxFps: inkMaxFps,
    },
  );
  setTimeout(() => scheduleFullPaint(), 200);
  if (isLiteMode()) {
    // 延迟 toast，等 store/App 挂上
    setTimeout(() => {
      void import("../state/store.js").then(({ useStore }) => {
        useStore.getState().toastMsg(liteModeToast(), "warn");
      });
    }, 400);
  }

  // 拉宽/拉窄：清屏 + 作废 diff 缓存 + 多帧强制重绘。
  // 仅 CSI 2J 而不 invalidate 时，行 diff 会认为「未变」跳过写出（拉宽尤其明显）。
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    syncTerminalSize(true);
    // 立刻同步 fakeStdout 尺寸，促 Ink 下一帧用新 columns/rows 排版
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    fakeStdout.columns = cols;
    fakeStdout.rows = rows;
    try {
      fakeStdout.emit?.("resize");
    } catch {
      /* ignore */
    }
    invalidatePaintCache();
    requestScreenRefresh({ clear: true });
    if (resizeTimer) clearTimeout(resizeTimer);
    // Yoga/Ink 异步排版：短间隔再刷两帧，等 lastGrid 跟上新宽度
    resizeTimer = setTimeout(() => {
      invalidatePaintCache();
      scheduleFullPaint();
      setTimeout(() => {
        invalidatePaintCache();
        scheduleFullPaint();
      }, 80);
    }, 48);
  };
  process.stdout.on("resize", onResize);
  process.on("SIGWINCH", onResize);

  await waitUntilExit();
  process.stdout.write("\x1b[?25h\x1b[?1006l\x1b[?1003l\x1b[?1049l");
}
