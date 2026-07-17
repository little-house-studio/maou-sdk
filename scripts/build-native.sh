#!/usr/bin/env bash
# 在用户本机构建平台相关原生件（不依赖我们预编译）。
# 目标：clone+构建后工作区尽量 <1GB（编完默认清理 Rust target 缓存）。
#
#   bash scripts/build-native.sh
#   bash scripts/build-native.sh --skip-ratatui
#   bash scripts/build-native.sh --js-only
#   bash scripts/build-native.sh --keep-target   # 开发迭代时保留 cargo target
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_RATATUI=0
JS_ONLY=0
KEEP_TARGET=0
for a in "$@"; do
  case "$a" in
    --skip-ratatui) SKIP_RATATUI=1 ;;
    --js-only) JS_ONLY=1 ;;
    --keep-target) KEEP_TARGET=1 ;;
    -h|--help)
      echo "Usage: $0 [--skip-ratatui] [--js-only] [--keep-target]"
      exit 0
      ;;
  esac
done

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

command -v node >/dev/null || die "need Node.js >= 20"
command -v npm >/dev/null || die "need npm"

# 中间产物放到系统临时目录，避免撑爆仓库目录（最终 .node / 二进制仍回写工程内）
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${TMPDIR:-/tmp}/maou-cargo-target-$$}"
export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-0}"
mkdir -p "$CARGO_TARGET_DIR"

log "[build-native] root=$ROOT platform=$(uname -s)/$(uname -m)"
log "[build-native] CARGO_TARGET_DIR=$CARGO_TARGET_DIR"

cleanup_rust_caches() {
  if [[ "$KEEP_TARGET" -eq 1 ]]; then
    log "[build-native] --keep-target: 保留 cargo 缓存"
    return 0
  fi
  log "[build-native] 清理 Rust 中间产物以控制磁盘…"
  # 仓库内历史 target（旧构建）
  rm -rf "$ROOT/terminal-engine/target" \
         "$ROOT/cli/tui-ratatui/target" \
         "$ROOT/cli/native/term-raster/target" 2>/dev/null || true
  # 本次临时 target
  if [[ -n "${CARGO_TARGET_DIR:-}" && "$CARGO_TARGET_DIR" == *maou-cargo-target* ]]; then
    rm -rf "$CARGO_TARGET_DIR" 2>/dev/null || true
  fi
  # 可选：sqry 本地索引缓存
  rm -rf "$ROOT/.sqry" 2>/dev/null || true
}

report_size() {
  if command -v du >/dev/null 2>&1; then
    local sz
    sz=$(du -sh "$ROOT" 2>/dev/null | awk '{print $1}')
    log "[build-native] 工作区约占用: $sz （目标 <1GB；pnpm 全局 store 另计）"
  fi
}

# 1) JS monorepo — Core fail-closed
if command -v pnpm >/dev/null 2>&1; then
  log "[build-native] pnpm install + build (Core)…"
  pnpm install
  pnpm -r run build
  [[ -f "$ROOT/cli/dist/index.js" ]] || die "Core failed: cli/dist/index.js missing"
else
  die "pnpm required for monorepo build (npm i -g pnpm)"
fi

if [[ "$JS_ONLY" -eq 1 ]]; then
  cleanup_rust_caches
  report_size
  log "[build-native] --js-only done (Core OK)"
  exit 0
fi

NATIVE_FAIL=0

# 2) DCG (download, no compile)
if [[ -f scripts/ensure-dcg.mjs ]]; then
  log "[build-native] dcg…"
  node scripts/ensure-dcg.mjs || log "[build-native] dcg failed (non-fatal)"
fi

# 3) terminal-engine (napi-rs) — release only
if [[ -d terminal-engine ]]; then
  if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
    log "[build-native] terminal-engine (napi, release)…"
    if ! (cd terminal-engine && npx --yes @napi-rs/cli build --release --platform); then
      log "[build-native] terminal-engine build failed (Terminal tier △)"
      NATIVE_FAIL=1
    fi
  else
    log "[build-native] skip terminal-engine: install Rust from https://rustup.rs (Terminal tier △)"
    NATIVE_FAIL=1
  fi
fi

# 4) ratatui TUI (optional; Windows / install 默认 --skip-ratatui)
if [[ "$SKIP_RATATUI" -eq 0 && -d cli/tui-ratatui ]]; then
  if command -v cargo >/dev/null 2>&1; then
    log "[build-native] maou-tui-ratatui (release)…"
    if ! (cd cli && npm run build:tui-ratatui); then
      log "[build-native] ratatui build failed — use MAOU_TUI=ink"
    fi
  else
    log "[build-native] skip ratatui: no cargo"
  fi
fi

# 5) node-pty rebuild (optional)
if command -v npm >/dev/null 2>&1; then
  log "[build-native] rebuild node-pty if present…"
  (cd cli && npm rebuild node-pty 2>/dev/null) || true
  (cd cli && npm rebuild @lydell/node-pty 2>/dev/null) || true
fi

cleanup_rust_caches
report_size

if [[ "$NATIVE_FAIL" -ne 0 ]]; then
  log "[build-native] Core OK; Terminal/native incomplete (doctor will show △)"
else
  log "[build-native] Core + native OK"
fi
log "Next: maou doctor && maou coding"
exit 0
