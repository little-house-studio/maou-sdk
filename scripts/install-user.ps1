# Maou 终端用户安装器（Windows 原生 PowerShell）—— 免构建。
#
# 只下载预编译包，不需要 git / pnpm / Rust / Visual Studio Build Tools，也不跑任何编译。
# 唯一前提：Node.js >= 20（没有的话本脚本可以装一份私有的到 %USERPROFILE%\.maou\runtime）。
#
#   irm https://raw.githubusercontent.com/little-house-studio/maou-sdk/develop/scripts/install-user.ps1 | iex
#
# 或下载后：
#   powershell -ExecutionPolicy Bypass -File scripts\install-user.ps1
#
# 环境变量：
#   MAOU_CHANNEL=stable|dev   发布通道（默认 stable，回退 dev）
#   MAOU_VERSION=v0.1.0       指定 Release tag
#   MAOU_REPO=owner/repo      默认 little-house-studio/maou-sdk
#   MAOU_HOME                 安装根，默认 %USERPROFILE%\.maou
#   MAOU_INSTALL_NODE=1|0     缺 Node 时是否自动装私有 Node
#   GITHUB_TOKEN              私有仓库 / 提高 API 限额
#   MAOU_NO_PATH=1            不改用户 PATH

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo      = if ($env:MAOU_REPO)    { $env:MAOU_REPO }    else { "little-house-studio/maou-sdk" }
$Channel   = if ($env:MAOU_CHANNEL) { $env:MAOU_CHANNEL } else { "stable" }
$MaouHome  = if ($env:MAOU_HOME)    { $env:MAOU_HOME }    else { Join-Path $env:USERPROFILE ".maou" }
$BinDir      = Join-Path $MaouHome "bin"
$VersionsDir = Join-Path $MaouHome "versions"
$RuntimeDir  = Join-Path $MaouHome "runtime"
$NodeMin = 20
$NodeLts = "22.20.0"

function Info($m) { Write-Host "  $m" }
function Step($m) { Write-Host "[maou] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

# ─────────────────────────── 平台探测 ──────────────────────────

function Get-PlatformTag {
    $a = $env:PROCESSOR_ARCHITECTURE
    if (-not $a) { $a = "AMD64" }
    switch ($a.ToUpper()) {
        "AMD64" { return "win32-x64" }
        "ARM64" { return "win32-arm64" }
        "X86"   { Fail "不支持 32 位 Windows" }
        default { Fail "不支持的架构: $a" }
    }
}

$Platform = Get-PlatformTag
$Asset    = "maou-$Platform.zip"

function Get-Headers {
    $h = @{ "User-Agent" = "maou-installer" }
    if ($env:GITHUB_TOKEN) { $h["Authorization"] = "Bearer $env:GITHUB_TOKEN" }
    return $h
}

# ─────────────────────────── Node 处理 ────────────────────────

function Test-NodeOk($exe) {
    try {
        $v = & $exe -p "process.versions.node.split('.')[0]" 2>$null
        return ([int]$v -ge $NodeMin)
    } catch { return $false }
}

function Resolve-Node {
    $priv = Join-Path $RuntimeDir "node\node.exe"
    if ((Test-Path $priv) -and (Test-NodeOk $priv)) { return $priv }
    $sys = Get-Command node -ErrorAction SilentlyContinue
    if ($sys -and (Test-NodeOk $sys.Source)) { return $sys.Source }
    return $null
}

function Install-PrivateNode {
    $arch = if ($Platform -eq "win32-arm64") { "arm64" } else { "x64" }
    $url  = "https://nodejs.org/dist/v$NodeLts/node-v$NodeLts-win-$arch.zip"
    $tmp  = Join-Path ([IO.Path]::GetTempPath()) ("maou-node-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zip = Join-Path $tmp "node.zip"
    Step "下载 Node.js v$NodeLts（仅供 maou 使用，不改系统 node）…"
    Invoke-WebRequest -Uri $url -OutFile $zip -Headers (Get-Headers) -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $src = Join-Path $tmp "node-v$NodeLts-win-$arch"
    if (-not (Test-Path $src)) { return $null }
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    $dest = Join-Path $RuntimeDir "node"
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Move-Item $src $dest
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    $exe = Join-Path $dest "node.exe"
    if (Test-Path $exe) { return $exe } else { return $null }
}

function Ensure-Node {
    $n = Resolve-Node
    if ($n) { Step "Node: $n ($(& $n -v))"; return $n }

    Step "未找到 Node.js >= $NodeMin。"
    $want = $env:MAOU_INSTALL_NODE
    if (-not $want) {
        if ([Environment]::UserInteractive -and $Host.UI.RawUI) {
            $ans = Read-Host "  自动安装一份私有 Node v$NodeLts 到 $RuntimeDir\node？[Y/n]"
            $want = if ($ans -match '^[nN]') { "0" } else { "1" }
        } else { $want = "1" }
    }
    if ($want -ne "1") { Fail "需要 Node.js >= $NodeMin。装好后重跑本脚本。" }
    $n = Install-PrivateNode
    if (-not $n) { Fail "私有 Node 安装失败 —— 请自行安装 Node >= $NodeMin 后重跑" }
    Step "私有 Node 就绪: $n ($(& $n -v))"
    return $n
}

# ───────────────────────── Release 解析 ───────────────────────

function Get-Release {
    param([string]$Ch)
    $url = if ($env:MAOU_VERSION) {
        "https://api.github.com/repos/$Repo/releases/tags/$($env:MAOU_VERSION)"
    } elseif ($Ch -eq "stable") {
        "https://api.github.com/repos/$Repo/releases/latest"
    } else {
        "https://api.github.com/repos/$Repo/releases/tags/bundle-dev"
    }
    try {
        return Invoke-RestMethod -Uri $url -Headers (Get-Headers) -UseBasicParsing
    } catch { return $null }
}

# ──────────────────────────── 安装 ────────────────────────────

Write-Host ""
Write-Host "  Maou 安装器 · 预编译包（免构建）" -ForegroundColor Cyan
Write-Host "  平台 $Platform · 仓库 $Repo · 通道 $Channel"
Write-Host ""

$NodeBin = Ensure-Node

Step "查询 Release…"
$rel = Get-Release $Channel
if (-not $rel -and $Channel -eq "stable" -and -not $env:MAOU_VERSION) {
    Step "stable 通道暂无 Release，回退 dev 通道…"
    $Channel = "dev"
    $rel = Get-Release $Channel
}
if (-not $rel) { Fail "找不到可用 Release。检查网络 / MAOU_REPO / MAOU_CHANNEL，或设 GITHUB_TOKEN。" }

$tag = $rel.tag_name
$assetObj = $rel.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1
if (-not $assetObj) {
    Fail "Release $tag 无本平台资产 $Asset（该平台可能尚未构建）`n   现有: $(($rel.assets | ForEach-Object { $_.name }) -join ', ')"
}
Step "Release $tag → $Asset"

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("maou-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    $zipPath = Join-Path $tmp $Asset
    Step "下载中…"
    Invoke-WebRequest -Uri $assetObj.browser_download_url -OutFile $zipPath -Headers (Get-Headers) -UseBasicParsing

    # 校验
    $sums = $rel.assets | Where-Object { $_.name -eq "SHA256SUMS.txt" } | Select-Object -First 1
    if ($sums) {
        try {
            $sumsPath = Join-Path $tmp "SHA256SUMS.txt"
            Invoke-WebRequest -Uri $sums.browser_download_url -OutFile $sumsPath -Headers (Get-Headers) -UseBasicParsing
            $line = Get-Content $sumsPath | Where-Object { $_ -match [regex]::Escape($Asset) } | Select-Object -First 1
            if ($line) {
                $expect = ($line -split '\s+')[0].ToLower()
                $actual = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower()
                if ($expect -ne $actual) { Fail "校验和不匹配（期望 $expect，实际 $actual）—— 拒绝安装" }
                Info "sha256 校验通过"
            }
        } catch { Info "校验和获取失败，跳过校验" }
    }

    Step "解压…"
    $x = Join-Path $tmp "x"
    New-Item -ItemType Directory -Force -Path $x | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $x -Force
    $src = Get-ChildItem -Path $x -Directory | Select-Object -First 1
    if (-not $src -or -not (Test-Path (Join-Path $src.FullName "RELEASE.json"))) {
        Fail "包结构异常（缺 RELEASE.json）"
    }

    New-Item -ItemType Directory -Force -Path $VersionsDir, $BinDir | Out-Null
    $target = Join-Path $VersionsDir $src.Name
    if (Test-Path $target) {
        Info "覆盖已存在的同版本目录 $($src.Name)"
        Remove-Item -Recurse -Force $target
    }
    Move-Item $src.FullName $target

    # current 指针：junction 优先，失败落文本指针
    $current = Join-Path $MaouHome "current"
    if (Test-Path $current) { Remove-Item -Recurse -Force $current -ErrorAction SilentlyContinue }
    $linked = $false
    try {
        New-Item -ItemType Junction -Path $current -Target $target -ErrorAction Stop | Out-Null
        $linked = $true
    } catch { $linked = $false }
    if (-not $linked) {
        Set-Content -Path (Join-Path $MaouHome "current.path") -Value $target -Encoding ASCII
        Info "无法建立 junction，已写 current.path 文本指针（启动器兼容）"
    }

    # 启动器：始终读 current
    $cmd = @'
@echo off
setlocal enabledelayedexpansion
if "%MAOU_HOME%"=="" set "MAOU_HOME=%USERPROFILE%\.maou"
set "ROOT=%MAOU_HOME%\current"
if not exist "%ROOT%\dist\index.js" (
  if exist "%MAOU_HOME%\current.path" (
    for /f "usebackq delims=" %%p in ("%MAOU_HOME%\current.path") do set "ROOT=%%p"
  )
)
if not exist "!ROOT!\dist\index.js" (
  echo maou: not installed ^(%MAOU_HOME%\current^) - re-run the installer 1>&2
  exit /b 1
)
set "NODE=%MAOU_NODE%"
if "%NODE%"=="" if exist "%MAOU_HOME%\runtime\node\node.exe" set "NODE=%MAOU_HOME%\runtime\node\node.exe"
if "%NODE%"=="" set "NODE=node"
set "PATH=!ROOT!\vendor\bin;%PATH%"
set "MAOU_BUNDLE_ROOT=!ROOT!"
"%NODE%" "!ROOT!\dist\index.js" %*
exit /b %ERRORLEVEL%
'@
    Set-Content -Path (Join-Path $BinDir "maou.cmd") -Value $cmd -Encoding ASCII

    $ps1 = @'
$ErrorActionPreference = "Stop"
$MaouHome = if ($env:MAOU_HOME) { $env:MAOU_HOME } else { Join-Path $env:USERPROFILE ".maou" }
$Root = Join-Path $MaouHome "current"
if (-not (Test-Path (Join-Path $Root "dist\index.js"))) {
    $ptr = Join-Path $MaouHome "current.path"
    if (Test-Path $ptr) { $Root = (Get-Content $ptr -Raw).Trim() }
}
if (-not (Test-Path (Join-Path $Root "dist\index.js"))) {
    Write-Error "maou: 未找到安装（$MaouHome\current）—— 请重跑安装脚本"; exit 1
}
$Node = if ($env:MAOU_NODE) { $env:MAOU_NODE }
        elseif (Test-Path (Join-Path $MaouHome "runtime\node\node.exe")) { Join-Path $MaouHome "runtime\node\node.exe" }
        else { "node" }
$env:PATH = "$Root\vendor\bin;$env:PATH"
$env:MAOU_BUNDLE_ROOT = $Root
& $Node "$Root\dist\index.js" @args
exit $LASTEXITCODE
'@
    Set-Content -Path (Join-Path $BinDir "maou.ps1") -Value $ps1 -Encoding UTF8

    # PATH（用户级）
    if ($env:MAOU_NO_PATH -ne "1") {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if (-not $userPath) { $userPath = "" }
        if ($userPath -notlike "*$BinDir*") {
            [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
            Info "已写入用户 PATH → $BinDir"
        }
        $env:Path = "$BinDir;$env:Path"
    }

    $version = "?"
    try { $version = (Get-Content (Join-Path $target "RELEASE.json") -Raw | ConvertFrom-Json).version } catch {}

    Write-Host ""
    Write-Host "✓ 安装完成" -ForegroundColor Green
    Info "版本:   $version ($tag, $Platform)"
    Info "位置:   $target"
    Info "启动器: $BinDir\maou.cmd"
    Write-Host ""
    Write-Host "下一步（若当前窗口找不到 maou，请开一个新的 PowerShell）："
    Info "maou doctor    # 检查组件"
    Info "maou setup     # 配置 API"
    Info "maou coding    # 启动编程 Agent"
    Write-Host ""
    Write-Host "更新: maou update      卸载: Remove-Item -Recurse -Force $MaouHome"
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
