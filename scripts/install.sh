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

WRAP="$BIN_DIR/maou"
cat > "$WRAP" <<EOF
#!/usr/bin/env bash
exec node "$CLI_DIST" "\$@"
EOF
chmod +x "$WRAP"
log "[maou] wrapper: $WRAP"

ENSURE="$REPO_ROOT/scripts/ensure-dcg.mjs"
if [[ -f "$ENSURE" ]]; then
  log "[maou] ensuring dcg…"
  node "$ENSURE" --user || die "dcg install failed"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    log ""
    log "Add to PATH:"
    log "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

log ""
log "Install finished."
log "  maou doctor     # Core / Terminal / Optional tiers"
log "  maou setup"
log "  maou coding"
log "Done."