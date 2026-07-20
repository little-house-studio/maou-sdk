#!/usr/bin/env bash
# 在用户本机构建平台相关原生件（不依赖我们预编译）。
# 目标：clone+构建后工作区尽量 <1GB（编完默认清理 Rust target 缓存）。
#
#   bash scripts/build-native.sh
#   bash scripts/build-native.sh --keep-target   # 开发迭代时保留 cargo target
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEEP_TARGET=0
for a in "$@"; do
  case "$a" in
    --keep-target) KEEP_TARGET=1 ;;
    -h|--help)
      echo "Usage: $0 [--keep-target]"
      exit 0
      ;;
  esac
done

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

command -v node >/dev/null || die "need Node.js >= 20"
command -v npm >/dev/null || die "need npm"

# 默认先尝试预编译；仅在需要本机构建时才强制 cargo
PREFER_PREBUILD=1
for a in "$@"; do
  case "$a" in
    --from-source|--force-build) PREFER_PREBUILD=0 ;;
  esac
done

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
  rm -rf "$ROOT/terminal-engine/target" \
         "$ROOT/cli/tui-ratatui/target" \
         "$ROOT/cli/native/term-raster/target" 2>/dev/null || true
  if [[ -n "${CARGO_TARGET_DIR:-}" && "$CARGO_TARGET_DIR" == *maou-cargo-target* ]]; then
    rm -rf "$CARGO_TARGET_DIR" 2>/dev/null || true
  fi
  rm -rf "$ROOT/.sqry" 2>/dev/null || true
}

report_size() {
  if command -v du >/dev/null 2>&1; then
    local sz
    sz=$(du -sh "$ROOT" 2>/dev/null | awk '{print $1}')
    log "[build-native] 工作区约占用: $sz （目标 <1GB；pnpm 全局 store 另计）"
  fi
}

if command -v pnpm >/dev/null 2>&1; then
  log "[build-native] pnpm install + build (Core)…"
  pnpm install
  pnpm -r run build
  [[ -f "$ROOT/cli/dist/index.js" ]] || die "Core failed: cli/dist/index.js missing"
else
  die "pnpm required for monorepo build (npm i -g pnpm)"
fi

if [[ -f scripts/ensure-dcg.mjs ]]; then
  log "[build-native] dcg…"
  node scripts/ensure-dcg.mjs || die "dcg install failed"
fi

# ── terminal-engine：预编译优先 ──────────────────────────────────────────
_te_ok=0
if [[ "$PREFER_PREBUILD" -eq 1 && -f scripts/ensure-terminal-engine.mjs ]]; then
  log "[build-native] terminal-engine：尝试预编译下载…"
  node scripts/ensure-terminal-engine.mjs && _te_ok=1 || true
fi
if [[ "$_te_ok" -eq 0 && -d terminal-engine ]]; then
  command -v cargo >/dev/null || die "Rust required for local terminal-engine build. Or publish prebuilds (docs/NATIVE_PREBUILD.md)."
  log "[build-native] terminal-engine (cargo build, release)…"
  if ! (cd terminal-engine && cargo build --release); then
    die "terminal-engine build failed. Check Rust installation."
  fi
  _dll="${CARGO_TARGET_DIR}/release/"
  case "$(uname -s)" in
    Darwin*) _dll="${_dll}libterminal_engine.dylib" ;;
    Linux*)  _dll="${_dll}libterminal_engine.so" ;;
    *)       die "unsupported OS for terminal-engine" ;;
  esac
  _node=""
  case "$(uname -s)-$(uname -m)" in
    Darwin-x86_64) _node="terminal_engine.darwin-x64.node" ;;
    Darwin-arm64)  _node="terminal_engine.darwin-arm64.node" ;;
    Linux-x86_64)  _node="terminal_engine.linux-x64-gnu.node" ;;
    Linux-aarch64) _node="terminal_engine.linux-arm64-gnu.node" ;;
    *)             die "unsupported platform for terminal-engine" ;;
  esac
  if [[ -f "$_dll" ]]; then
    cp "$_dll" "terminal-engine/$_node"
    cp "$_dll" "terminal-engine/terminal-engine.${_node#terminal_engine.}" 2>/dev/null || true
  fi
  if [[ ! -f "terminal-engine/$_node" ]]; then
    die "terminal-engine .node missing: terminal-engine/$_node"
  fi
fi

# ── maou-tui：预编译优先 ────────────────────────────────────────────────
_tui_ok=0
if [[ "$PREFER_PREBUILD" -eq 1 && -f scripts/ensure-maou-tui.mjs ]]; then
  log "[build-native] maou-tui：尝试预编译下载…"
  node scripts/ensure-maou-tui.mjs && _tui_ok=1 || true
fi
if [[ "$_tui_ok" -eq 0 && -d cli/tui-ratatui ]]; then
  command -v cargo >/dev/null || die "Rust required for local ratatui build. Or publish prebuilds."
  log "[build-native] maou-tui-ratatui (release)…"
  if ! (cd cli && npm run build:tui-ratatui); then
    die "ratatui build failed. Check Rust installation."
  fi
  _ratatui_bin="${CARGO_TARGET_DIR}/release/maou-tui-ratatui"
  if [[ ! -f "$_ratatui_bin" ]]; then
    _ratatui_bin="cli/tui-ratatui/target/release/maou-tui-ratatui"
  fi
  if [[ ! -f "$_ratatui_bin" ]]; then
    die "ratatui binary missing: $_ratatui_bin"
  fi
  _maou_bin="${MAOU_HOME:-$HOME/.maou}/bin"
  mkdir -p "$_maou_bin"
  cp "$_ratatui_bin" "$_maou_bin/maou-tui-ratatui"
  chmod +x "$_maou_bin/maou-tui-ratatui"
  log "[build-native] ratatui binary copied to $_maou_bin"
fi

if command -v npm >/dev/null 2>&1; then
  log "[build-native] rebuild node-pty if present…"
  node_pty_ok=1
  (cd cli && npm rebuild node-pty 2>/dev/null) || node_pty_ok=0
  (cd cli && npm rebuild @lydell/node-pty 2>/dev/null) || node_pty_ok=0
  if [[ "$node_pty_ok" -ne 0 ]]; then
    log "[build-native] node-pty rebuild: ✓（遗留依赖；use_terminal 主路径为 terminal-engine 管道）"
  else
    log "[build-native] ⚠ node-pty rebuild 失败 — 可忽略；use_terminal 由 terminal-engine 驱动，不依赖 node-pty"
  fi
fi

cleanup_rust_caches
report_size
log "[build-native] Core + native OK"
log "Next: maou doctor && maou coding"
exit 0