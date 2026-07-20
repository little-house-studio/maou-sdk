#!/usr/bin/env bash
# Maou installer (macOS / Linux). Does NOT install Node.
# Fail-closed: Full build must succeed or exit 1.
#
#   bash scripts/install.sh
set -euo pipefail

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node >= 20 first."
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node >= 20 required (found $(node -v))"
command -v npm >/dev/null 2>&1 || die "npm not found"
command -v cargo >/dev/null 2>&1 || die "Rust required. Install: https://www.rust-lang.org/tools/install"

MAOU_HOME="${MAOU_HOME:-$HOME/.maou}"
BIN_DIR="${MAOU_BIN_DIR:-$MAOU_HOME/bin}"
mkdir -p "$BIN_DIR" "$MAOU_HOME"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$REPO_ROOT/pnpm-workspace.yaml" || ! -d "$REPO_ROOT/cli" ]]; then
  die "Not a maou-sdk monorepo root. Clone the full repo and run: bash scripts/install.sh"
fi

command -v pnpm >/dev/null 2>&1 || die "pnpm required. Install: npm i -g pnpm"

log "[maou] monorepo: $REPO_ROOT"
log "[maou] building Core + Native…"

if [[ -f "$REPO_ROOT/scripts/build-native.sh" ]]; then
  bash "$REPO_ROOT/scripts/build-native.sh"
else
  (cd "$REPO_ROOT" && pnpm install && pnpm -r run build) || die "pnpm build failed"
fi

CLI_DIST="$REPO_ROOT/cli/dist/index.js"
[[ -f "$CLI_DIST" ]] || die "cli/dist/index.js missing after build — Core incomplete"

# Install launcher into ~/.maou/bin + Homebrew/local PATH dirs (no manual PATH setup)
bash "$REPO_ROOT/scripts/install-cli-launcher.sh" "$REPO_ROOT" "$CLI_DIST"

ENSURE_DCG="$REPO_ROOT/scripts/ensure-dcg.mjs"
if [[ -f "$ENSURE_DCG" ]]; then
  log "[maou] ensuring dcg…"
  node "$ENSURE_DCG" --user || die "dcg install failed"
fi
ENSURE_RG="$REPO_ROOT/scripts/ensure-rg.mjs"
if [[ -f "$ENSURE_RG" ]]; then
  log "[maou] ensuring rg (ripgrep)…"
  node "$ENSURE_RG" --user || log "[maou] ⚠ rg install failed — grep 将降级为 Node.js（可稍后: node scripts/ensure-rg.mjs）"
fi
# sqry：Coding Agent find_code 必选（结构/符号搜索）
ENSURE_SQRY="$REPO_ROOT/scripts/ensure-sqry.mjs"
if [[ -f "$ENSURE_SQRY" ]]; then
  log "[maou] ensuring sqry (find_code)…"
  if ! node "$ENSURE_SQRY" --user; then
    if command -v cargo >/dev/null 2>&1; then
      log "[maou] ensure-sqry 失败，回退 cargo install sqry-cli…"
      cargo install sqry-cli || die "sqry install failed — find_code 不可用。手动: node scripts/ensure-sqry.mjs --user"
      # cargo 装到 ~/.cargo/bin，复制到 MAOU bin 便于 PATH
      if [[ -x "${CARGO_HOME:-$HOME/.cargo}/bin/sqry" ]]; then
        cp "${CARGO_HOME:-$HOME/.cargo}/bin/sqry" "$BIN_DIR/sqry"
        chmod +x "$BIN_DIR/sqry"
      fi
    else
      die "sqry install failed and no cargo. 手动: node scripts/ensure-sqry.mjs --user"
    fi
  fi
fi

# PATH / multi-shell wiring already handled by install-cli-launcher.sh
export PATH="$BIN_DIR:${PATH:-}"

log ""
log "Install finished."
if command -v maou >/dev/null 2>&1; then
  log "  maou is ready: $(command -v maou)"
else
  log "  Open a NEW terminal (or: export PATH=\"\$HOME/.maou/bin:\$PATH\")"
fi
log "  maou doctor     # Core / Terminal / Coding 依赖（含 sqry）"
log "  maou setup"
log "  maou coding"
log "Done."