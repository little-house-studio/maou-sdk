#!/usr/bin/env bash
# Maou 终端用户安装器（macOS / Linux）—— 免构建。
#
# 只下载预编译包，不需要 git / pnpm / Rust / C++ 工具链，也不跑任何编译。
# 唯一前提：Node.js >= 20（没有的话本脚本可以装一份私有的到 ~/.maou/runtime）。
#
#   curl -fsSL https://raw.githubusercontent.com/little-house-studio/maou-sdk/develop/scripts/install-user.sh | bash
#
# 环境变量：
#   MAOU_CHANNEL=stable|dev     发布通道（默认 stable，回退 dev）
#   MAOU_VERSION=v0.1.0         指定 Release tag
#   MAOU_REPO=owner/repo        默认 little-house-studio/maou-sdk
#   MAOU_HOME=~/.maou           安装根
#   MAOU_INSTALL_NODE=1|0       缺 Node 时是否自动装私有 Node（默认 1，交互时会问）
#   GITHUB_TOKEN=...            私有仓库 / 提高 API 限额
#   MAOU_NO_PATH=1              不改 shell 配置

set -euo pipefail

REPO="${MAOU_REPO:-little-house-studio/maou-sdk}"
CHANNEL="${MAOU_CHANNEL:-stable}"
MAOU_HOME="${MAOU_HOME:-$HOME/.maou}"
BIN_DIR="$MAOU_HOME/bin"
VERSIONS_DIR="$MAOU_HOME/versions"
RUNTIME_DIR="$MAOU_HOME/runtime"
NODE_MIN=20
NODE_LTS="22.20.0"

log()  { printf '%s\n' "$*" >&2; }
info() { printf '  %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1; }

# ─────────────────────────── 平台探测 ──────────────────────────

detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux)  os=linux ;;
    *) die "不支持的系统: $(uname -s)（Windows 请用 scripts\\install-user.ps1）" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) die "不支持的架构: $(uname -m)" ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

PLATFORM="$(detect_platform)"
ASSET="maou-${PLATFORM}.tar.gz"

# ──────────────────────────── 下载工具 ─────────────────────────

if need curl; then
  DL() { curl -fsSL --retry 3 --retry-delay 1 ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} "$1" -o "$2"; }
  DL_STDOUT() { curl -fsSL --retry 3 ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} "$1"; }
elif need wget; then
  DL() { wget -qO "$2" ${GITHUB_TOKEN:+--header="Authorization: Bearer $GITHUB_TOKEN"} "$1"; }
  DL_STDOUT() { wget -qO- ${GITHUB_TOKEN:+--header="Authorization: Bearer $GITHUB_TOKEN"} "$1"; }
else
  die "需要 curl 或 wget"
fi

# ─────────────────────────── Node 处理 ────────────────────────

node_ok() {
  local n="${1:-node}"
  need "$n" || return 1
  local major
  major="$("$n" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge "$NODE_MIN" ] 2>/dev/null
}

install_private_node() {
  local os arch nodeos nodearch url tarball
  case "$PLATFORM" in
    darwin-arm64) nodeos=darwin; nodearch=arm64 ;;
    darwin-x64)   nodeos=darwin; nodearch=x64 ;;
    linux-x64)    nodeos=linux;  nodearch=x64 ;;
    linux-arm64)  nodeos=linux;  nodearch=arm64 ;;
    *) return 1 ;;
  esac
  url="https://nodejs.org/dist/v${NODE_LTS}/node-v${NODE_LTS}-${nodeos}-${nodearch}.tar.gz"
  tarball="$(mktemp -d)/node.tar.gz"
  log "[maou] 下载 Node.js v${NODE_LTS}（仅供 maou 使用，不改系统 node）…"
  DL "$url" "$tarball" || return 1
  mkdir -p "$RUNTIME_DIR"
  rm -rf "$RUNTIME_DIR/node"
  tar -xzf "$tarball" -C "$RUNTIME_DIR"
  mv "$RUNTIME_DIR/node-v${NODE_LTS}-${nodeos}-${nodearch}" "$RUNTIME_DIR/node"
  rm -rf "$(dirname "$tarball")"
  [ -x "$RUNTIME_DIR/node/bin/node" ]
}

resolve_node() {
  if [ -x "$RUNTIME_DIR/node/bin/node" ] && node_ok "$RUNTIME_DIR/node/bin/node"; then
    printf '%s' "$RUNTIME_DIR/node/bin/node"; return 0
  fi
  if node_ok node; then command -v node; return 0; fi
  return 1
}

ensure_node() {
  local n
  if n="$(resolve_node)"; then
    log "[maou] Node: $n ($("$n" -v))"
    NODE_BIN="$n"
    return 0
  fi
  log "[maou] 未找到 Node.js >= ${NODE_MIN}。"
  local want="${MAOU_INSTALL_NODE:-}"
  if [ -z "$want" ]; then
    if [ -t 0 ]; then
      printf '  自动安装一份私有 Node v%s 到 %s？[Y/n] ' "$NODE_LTS" "$RUNTIME_DIR/node" >&2
      read -r ans </dev/tty || ans=y
      case "${ans:-y}" in [nN]*) want=0 ;; *) want=1 ;; esac
    else
      # 管道安装（curl | bash）没有 tty，默认装，否则整个安装没意义
      want=1
    fi
  fi
  [ "$want" = "1" ] || die "需要 Node.js >= ${NODE_MIN}。装好后重跑本脚本。"
  install_private_node || die "私有 Node 安装失败 —— 请自行安装 Node >= ${NODE_MIN} 后重跑"
  NODE_BIN="$RUNTIME_DIR/node/bin/node"
  log "[maou] 私有 Node 就绪: $NODE_BIN ($("$NODE_BIN" -v))"
}

# ───────────────────────── Release 解析 ───────────────────────

api_release_url() {
  case "$1" in
    stable) printf 'https://api.github.com/repos/%s/releases/latest' "$REPO" ;;
    *)      printf 'https://api.github.com/repos/%s/releases/tags/bundle-dev' "$REPO" ;;
  esac
}

# 从 Release JSON 里挑出资产下载地址（不依赖 jq）
asset_url_from_json() {
  local json="$1" name="$2"
  printf '%s' "$json" \
    | tr ',{}' '\n\n\n' \
    | grep -F '"browser_download_url"' \
    | sed -E 's/.*"browser_download_url" *: *"([^"]+)".*/\1/' \
    | grep -E "/${name}$" \
    | head -n 1
}

release_tag_from_json() {
  printf '%s' "$1" | tr ',{}' '\n\n\n' | grep -F '"tag_name"' \
    | sed -E 's/.*"tag_name" *: *"([^"]+)".*/\1/' | head -n 1
}

fetch_release_json() {
  local url
  if [ -n "${MAOU_VERSION:-}" ]; then
    url="https://api.github.com/repos/${REPO}/releases/tags/${MAOU_VERSION}"
  else
    url="$(api_release_url "$CHANNEL")"
  fi
  DL_STDOUT "$url" 2>/dev/null || true
}

# ──────────────────────────── 安装 ────────────────────────────

main() {
  log ""
  log "  Maou 安装器 · 预编译包（免构建）"
  log "  平台 ${PLATFORM} · 仓库 ${REPO} · 通道 ${CHANNEL}"
  log ""

  need tar || die "需要 tar"
  ensure_node

  log "[maou] 查询 Release…"
  RELEASE_JSON="$(fetch_release_json)"
  if [ -z "$RELEASE_JSON" ] || ! printf '%s' "$RELEASE_JSON" | grep -q '"tag_name"'; then
    if [ "$CHANNEL" = "stable" ] && [ -z "${MAOU_VERSION:-}" ]; then
      log "[maou] stable 通道暂无 Release，回退 dev 通道…"
      CHANNEL=dev
      RELEASE_JSON="$(fetch_release_json)"
    fi
  fi
  printf '%s' "$RELEASE_JSON" | grep -q '"tag_name"' \
    || die "找不到可用 Release。检查网络 / MAOU_REPO / MAOU_CHANNEL，或设 GITHUB_TOKEN。"

  TAG="$(release_tag_from_json "$RELEASE_JSON")"
  URL="$(asset_url_from_json "$RELEASE_JSON" "$ASSET")"
  [ -n "$URL" ] || die "Release ${TAG} 无本平台资产 ${ASSET}（该平台可能尚未构建）"

  log "[maou] Release ${TAG} → ${ASSET}"

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  log "[maou] 下载中…"
  DL "$URL" "$TMP/$ASSET" || die "下载失败: $URL"

  # 校验（有 SHA256SUMS.txt 就校验）
  SUMS_URL="$(asset_url_from_json "$RELEASE_JSON" "SHA256SUMS.txt")"
  if [ -n "$SUMS_URL" ]; then
    if DL "$SUMS_URL" "$TMP/SHA256SUMS.txt" 2>/dev/null; then
      EXPECT="$(grep -F " $ASSET" "$TMP/SHA256SUMS.txt" 2>/dev/null | awk '{print $1}' | head -n1 || true)"
      if [ -n "$EXPECT" ]; then
        if need sha256sum; then ACTUAL="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"
        elif need shasum; then ACTUAL="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
        else ACTUAL=""; fi
        if [ -n "$ACTUAL" ] && [ "$ACTUAL" != "$EXPECT" ]; then
          die "校验和不匹配（期望 $EXPECT，实际 $ACTUAL）—— 拒绝安装"
        fi
        [ -n "$ACTUAL" ] && info "sha256 校验通过"
      fi
    fi
  fi

  log "[maou] 解压…"
  mkdir -p "$TMP/x"
  tar -xzf "$TMP/$ASSET" -C "$TMP/x"
  SRC="$(find "$TMP/x" -maxdepth 1 -mindepth 1 -type d | head -n1)"
  [ -n "$SRC" ] && [ -f "$SRC/RELEASE.json" ] || die "包结构异常（缺 RELEASE.json）"
  DIRNAME="$(basename "$SRC")"

  mkdir -p "$VERSIONS_DIR" "$BIN_DIR"
  TARGET="$VERSIONS_DIR/$DIRNAME"
  if [ -d "$TARGET" ]; then
    info "覆盖已存在的同版本目录 $DIRNAME"
    rm -rf "$TARGET"
  fi
  mv "$SRC" "$TARGET"
  chmod +x "$TARGET/bin/maou" 2>/dev/null || true
  chmod +x "$TARGET/vendor/bin/"* 2>/dev/null || true

  # current 指针
  rm -rf "$MAOU_HOME/current"
  ln -sfn "$TARGET" "$MAOU_HOME/current"

  # 启动器：始终读 current，换版本无需重写
  cat > "$BIN_DIR/maou" <<'LAUNCHER'
#!/bin/sh
# maou launcher —— 指向 ~/.maou/current（由安装器/更新器维护）
MAOU_HOME="${MAOU_HOME:-$HOME/.maou}"
ROOT="$MAOU_HOME/current"
if [ ! -d "$ROOT" ] && [ -f "$MAOU_HOME/current.path" ]; then
  ROOT="$(cat "$MAOU_HOME/current.path")"
fi
[ -d "$ROOT" ] || { echo "maou: 未找到安装（$MAOU_HOME/current）—— 请重跑安装脚本" >&2; exit 1; }

NODE="${MAOU_NODE:-}"
if [ -z "$NODE" ] && [ -x "$MAOU_HOME/runtime/node/bin/node" ]; then
  NODE="$MAOU_HOME/runtime/node/bin/node"
fi
[ -z "$NODE" ] && NODE=node
command -v "$NODE" >/dev/null 2>&1 || { echo "maou: 需要 Node.js >= 20" >&2; exit 1; }

PATH="$ROOT/vendor/bin:$PATH"
export PATH
export MAOU_BUNDLE_ROOT="$ROOT"
exec "$NODE" "$ROOT/dist/index.js" "$@"
LAUNCHER
  chmod +x "$BIN_DIR/maou"

  # PATH
  if [ "${MAOU_NO_PATH:-}" != "1" ]; then
    add_to_path
  fi

  VERSION="$("$NODE_BIN" -e "try{console.log(JSON.parse(require('fs').readFileSync('$TARGET/RELEASE.json','utf8')).version)}catch(e){console.log('?')}" 2>/dev/null || echo '?')"

  log ""
  log "✓ 安装完成"
  info "版本:   $VERSION ($TAG, $PLATFORM)"
  info "位置:   $TARGET"
  info "启动器: $BIN_DIR/maou"
  log ""
  if need maou; then
    log "下一步："
  else
    log "下一步（当前 shell 还没有 PATH，先执行下面第一行）："
    info "export PATH=\"$BIN_DIR:\$PATH\""
  fi
  info "maou doctor    # 检查组件"
  info "maou setup     # 配置 API"
  info "maou coding    # 启动编程 Agent"
  log ""
  log "更新: maou update      卸载: rm -rf $MAOU_HOME"
}

add_to_path() {
  case ":${PATH}:" in *":$BIN_DIR:"*) return 0 ;; esac
  local line="export PATH=\"$BIN_DIR:\$PATH\""
  local added=0
  for rc in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    if ! grep -Fq "$BIN_DIR" "$rc" 2>/dev/null; then
      printf '\n# maou\n%s\n' "$line" >> "$rc"
      info "已写入 PATH → $rc"
      added=1
    else
      added=1
    fi
  done
  if [ "$added" = "0" ]; then
    printf '\n# maou\n%s\n' "$line" >> "$HOME/.profile"
    info "已写入 PATH → $HOME/.profile"
  fi
}

main "$@"
