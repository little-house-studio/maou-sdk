#!/usr/bin/env bash
# 清理本机构建缓存，缩小工作区（不删 node_modules / dist / 最终 .node）
#   bash scripts/clean-build-cache.sh
#   bash scripts/clean-build-cache.sh --all   # 连 node_modules 也删（需重装）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALL=0
[[ "${1:-}" == "--all" ]] && ALL=1

log() { printf '%s\n' "$*" >&2; }
log "[clean] before: $(du -sh "$ROOT" 2>/dev/null | awk '{print $1}')"

rm -rf \
  "$ROOT/terminal-engine/target" \
  "$ROOT/cli/tui-ratatui/target" \
  "$ROOT/cli/native/term-raster/target" \
  "$ROOT/.sqry" \
  "$ROOT"/cli/scroll-bench-result.txt \
  2>/dev/null || true

# temp cargo dirs
rm -rf "${TMPDIR:-/tmp}"/maou-cargo-target* 2>/dev/null || true

if [[ "$ALL" -eq 1 ]]; then
  log "[clean] removing node_modules + dist…"
  find "$ROOT" -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true
  find "$ROOT" -type d -name dist -prune -exec rm -rf {} + 2>/dev/null || true
fi

log "[clean] after:  $(du -sh "$ROOT" 2>/dev/null | awk '{print $1}')"
log "Git 跟踪内容本身约 ~10MB；体积来自本机构建缓存。"
