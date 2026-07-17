# 在当前 Mac 上如何测 Windows（原生，非「假装完美」）

**结论：在这台只有 macOS + Docker 的机器上，无法 100% 等价跑「原生 Windows + ConPTY + MSVC 链」；只能近似或换机器。**

## 方案对比

| 方案 | 能否测原生 Win | 你这台 M1 Mac | 说明 |
|------|----------------|---------------|------|
| **真 Windows PC / 虚拟机** | ✅ 最佳 | 需装 UTM/Parallels + Win11 ARM 或外接 x64 机 | 唯一可靠验收 |
| **UTM / Parallels Win11 ARM** | ✅ 接近 | 需自行安装 Windows 镜像 | Apple Silicon 官方路径 |
| **GitHub Actions `windows-latest`** | ✅ CI 级 | 有网即可 | 免费跑 `build-native.ps1` + `maou doctor` |
| **Docker `windows` 容器** | ❌ 基本不行 | Docker Desktop for Mac **不能**跑 Windows 容器 | Windows 容器要 Windows 主机 |
| **Wine** | ❌ 不可靠 | 本机无 wine；PTY/napi 几乎必挂 | 不推荐 |
| **WSL** | ❌ 不算原生 Win | — | 产品要求是非 WSL |

本机探测：`docker` ✅ · `utm`/`qemu`/`wine64` ❌。

## 推荐：GitHub Actions（不占本机）

在仓库加 workflow（示例思路，可自行粘贴）：

```yaml
# .github/workflows/windows-smoke.yml
name: windows-smoke
on: [workflow_dispatch]
jobs:
  win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - run: powershell -ExecutionPolicy Bypass -File scripts/build-native.ps1 -SkipRatatui
      - run: node scripts/ensure-dcg.mjs --user
      - run: node cli/dist/index.js doctor
```

这能验证：**用户本机构建脚本在微软官方 Win 镜像上是否能过**（仍非你本机 GUI 交互）。

## 推荐：本机 UTM 装 Win11 ARM（完整交互）

1. 安装 [UTM](https://mac.getutm.app/)  
2. 下载 Windows 11 ARM 镜像（Microsoft）  
3. 虚拟机内：装 Node 20、Rust、VS Build Tools、Git、pnpm  
4. 克隆仓库 → `scripts\install.ps1` 或 `build-native.ps1`  
5. `maou doctor` → `maou coding`  

与真实用户最接近（仍是 ARM Win，与部分 x64 插件有差异）。

## 我们仓库的立场

- **不**在仓库里提交/CI 预编译 `terminal-engine` / `node-pty` / ratatui 等环境相关二进制。  
- **要**在用户电脑上：`build-native.sh` / `build-native.ps1` 完成本机构建。  
- 测 Windows：优先 **真机/UTM** 或 **Actions windows-latest**，不要用 Docker-for-Mac 假装 Windows。

## 快速命令（用户 Windows 真机）

```powershell
# 依赖：Node20 + rustup(MSVC) + VS C++ Build Tools + pnpm
cd maou-sdk
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
$env:Path = "$env:USERPROFILE\.maou\bin;" + $env:Path
maou doctor
maou setup
maou coding   # 默认 Ink
```
