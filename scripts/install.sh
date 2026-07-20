#!/usr/bin/env bash
# Maou installer (macOS / Linux). Does NOT install Node.
#
# 默认路径：Node/pnpm + 预编译原生组件（无需 Rust）。
# 开发者本机构建：MAOU_BUILD_NATIVE=1 bash scripts/install.sh
#
#   bash scripts/install.sh
set -euo pipefail

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node >= 20 first."
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node >= 20 required (found $(node -v))"
command -v npm >/dev/null 2>&1 || die "npm not found"
command -v pnpm >/dev/null 2>&1 || die "pnpm required. Install: npm i -g pnpm"

MAOU_HOME="${MAOU_HOME:-$HOME/.maou}"
BIN_DIR="${MAOU_BIN_DIR:-$MAOU_HOME/bin}"
mkdir -p "$BIN_DIR" "$MAOU_HOME"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$REPO_ROOT/pnpm-workspace.yaml" || ! -d "$REPO_ROOT/cli" ]]; then
  die "Not a maou-sdk monorepo root. Clone the full repo and run: bash scripts/install.sh"
fi

log "[maou] monorepo: $REPO_ROOT"
log "[maou] building Core (JS)…"

(
  cd "$REPO_ROOT"
  pnpm install
  pnpm -r run build
) || die "pnpm build failed"

CLI_DIST="$REPO_ROOT/cli/dist/index.js"
[[ -f "$CLI_DIST" ]] || die "cli/dist/index.js missing after build — Core incomplete"

# 预编译原生：terminal-engine + ratatui（无需 Rust）
log "[maou] ensuring prebuilt terminal-engine…"
node "$REPO_ROOT/scripts/ensure-terminal-engine.mjs" || log "[maou] ⚠ terminal-engine ensure 有警告"

log "[maou] ensuring prebuilt maou-tui…"
node "$REPO_ROOT/scripts/ensure-maou-tui.mjs" || log "[maou] ⚠ maou-tui ensure 有警告"

# 可选：本机 cargo 全量 native（开发者）
if [[ "${MAOU_BUILD_NATIVE:-}" == "1" || "${MAOU_BUILD_NATIVE:-}" == "true" ]]; then
  if command -v cargo >/dev/null 2>&1; then
    log "[maou] MAOU_BUILD_NATIVE=1 → bash scripts/build-native.sh（本机构建）…"
    bash "$REPO_ROOT/scripts/build-native.sh" || log "[maou] ⚠ build-native 失败"
  else
    log "[maou] MAOU_BUILD_NATIVE=1 但未安装 cargo，跳过本机构建"
  fi
fi

bash "$REPO_ROOT/scripts/install-cli-launcher.sh" "$REPO_ROOT" "$CLI_DIST"

ENSURE_DCG="$REPO_ROOT/scripts/ensure-dcg.mjs"
if [[ -f "$ENSURE_DCG" ]]; then
  log "[maou] ensuring dcg…"
  node "$ENSURE_DCG" --user || die "dcg install failed"
fi
ENSURE_RG="$REPO_ROOT/scripts/ensure-rg.mjs"
if [[ -f "$ENSURE_RG" ]]; then
  log "[maou] ensuring rg (ripgrep)…"
  node "$ENSURE_RG" --user || log "[maou] ⚠ rg install failed — grep 将降级为 Node.js"
fi
ENSURE_SQRY="$REPO_ROOT/scripts/ensure-sqry.mjs"
if [[ -f "$ENSURE_SQRY" ]]; then
  log "[maou] ensuring sqry (find_code)…"
  if ! node "$ENSURE_SQRY" --user; then
    if command -v cargo >/dev/null 2>&1; then
      log "[maou] ensure-sqry 失败，回退 cargo install sqry-cli…"
      cargo install sqry-cli || log "[maou] ⚠ sqry install failed"
      if [[ -x "${CARGO_HOME:-$HOME/.cargo}/bin/sqry" ]]; then
        cp "${CARGO_HOME:-$HOME/.cargo}/bin/sqry" "$BIN_DIR/sqry"
        chmod +x "$BIN_DIR/sqry"
      fi
    else
      log "[maou] ⚠ sqry 未安装且无 cargo — find_code 可能不可用"
    fi
  fi
fi

export PATH="$BIN_DIR:${PATH:-}"

log ""
log "Install finished."
if command -v maou >/dev/null 2>&1; then
  log "  maou is ready: $(command -v maou)"
else
  log "  Open a NEW terminal (or: export PATH=\"\$HOME/.maou/bin:\$PATH\")"
fi
log "  maou doctor"
log "  maou setup"
log "  maou coding"
log ""
log "原生组件：默认从 GitHub Release「native-prebuilds」下载（无需 Rust）。"
log "开发者本机构建：MAOU_BUILD_NATIVE=1 bash scripts/install.sh"
log "详见 docs/NATIVE_PREBUILD.md"
log "Done."
