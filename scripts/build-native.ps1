param(
  [switch]$KeepTarget,
  [switch]$FromSource
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Root) { $Root = (Get-Location).Path }
Set-Location $Root

function Log([string]$m) { Write-Host $m }
function Die([string]$m) { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "need Node.js >= 20" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Die "need npm" }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Die "need pnpm (npm i -g pnpm)" }
$PreferPrebuild = -not $FromSource
$HasCargo = [bool](Get-Command cargo -ErrorAction SilentlyContinue)

$cargoTmp = Join-Path $env:TEMP ("maou-cargo-target-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$env:CARGO_TARGET_DIR = $cargoTmp
$env:CARGO_INCREMENTAL = "0"
New-Item -ItemType Directory -Force -Path $cargoTmp | Out-Null

function Cleanup-RustCaches {
  if ($KeepTarget) {
    Log "[build-native] -KeepTarget: keep cargo caches"
    return
  }
  Log "[build-native] cleaning Rust intermediate artifacts..."
  @(
    (Join-Path $Root "terminal-engine\target"),
    (Join-Path $Root "cli\tui-ratatui\target"),
    (Join-Path $Root "cli\native\term-raster\target")
  ) | ForEach-Object {
    if (Test-Path $_) { Remove-Item -Recurse -Force $_ -ErrorAction SilentlyContinue }
  }
  if ($env:CARGO_TARGET_DIR -and ($env:CARGO_TARGET_DIR -like "*maou-cargo-target*")) {
    Remove-Item -Recurse -Force $env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
  }
}

function Report-Size {
  try {
    $bytes = (Get-ChildItem -Path $Root -Recurse -Force -ErrorAction SilentlyContinue |
      Measure-Object -Property Length -Sum).Sum
    $mb = [math]::Round($bytes / 1MB, 0)
    Log "[build-native] workspace ~${mb} MB (goal less than 1000 MB; pnpm global store separate)"
  } catch {}
}

Log "[build-native] root=$Root"
Log "[build-native] CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR"

Log "[build-native] pnpm install + build (Core)..."
pnpm install
pnpm -r run build
$cliDist = Join-Path $Root "cli\dist\index.js"
if (-not (Test-Path $cliDist)) {
  Die "Core failed: cli\dist\index.js missing"
}

$ensure = Join-Path $Root "scripts\ensure-dcg.mjs"
if (Test-Path $ensure) {
  Log "[build-native] dcg..."
  node $ensure
}

$teOk = $false
if ($PreferPrebuild) {
  $ensureTe = Join-Path $Root "scripts\ensure-terminal-engine.mjs"
  if (Test-Path $ensureTe) {
    Log "[build-native] terminal-engine: try prebuild download..."
    node $ensureTe
    $teNode = Join-Path $Root "terminal-engine\terminal_engine.win32-x64-msvc.node"
    if (Test-Path $teNode) { $teOk = $true }
  }
}
$te = Join-Path $Root "terminal-engine"
if (-not $teOk -and (Test-Path $te)) {
  if (-not $HasCargo) {
    Die "terminal-engine missing and no cargo. Publish prebuilds (docs/NATIVE_PREBUILD.md) or install Rust + VS Build Tools."
  }
  Log "[build-native] terminal-engine (cargo build, release)..."
  Push-Location $te
  try {
    cargo build --release
  } catch {
    Die "terminal-engine build failed. Install VS Build Tools: winget install Microsoft.VisualStudio.2022.BuildTools --override --wait --add Microsoft.VisualStudio.Workload.VCTools"
  }
  Pop-Location
  $dll = Join-Path $env:CARGO_TARGET_DIR "release\terminal_engine.dll"
  $teNode = Join-Path $te "terminal_engine.win32-x64-msvc.node"
  if (Test-Path $dll) {
    Copy-Item $dll $teNode -Force
    Copy-Item $dll (Join-Path $te "terminal-engine.win32-x64-msvc.node") -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path $teNode)) {
    Die "terminal-engine .node missing: $teNode"
  }
}

$tuiOk = $false
if ($PreferPrebuild) {
  $ensureTui = Join-Path $Root "scripts\ensure-maou-tui.mjs"
  if (Test-Path $ensureTui) {
    Log "[build-native] maou-tui: try prebuild download..."
    node $ensureTui
    $userTui = Join-Path $env:USERPROFILE ".maou\bin\maou-tui-ratatui.exe"
    if (Test-Path $userTui) { $tuiOk = $true }
  }
}
$rt = Join-Path $Root "cli\tui-ratatui"
if (-not $tuiOk -and (Test-Path $rt)) {
  if (-not $HasCargo) {
    Die "maou-tui missing and no cargo. Publish prebuilds or install Rust."
  }
  Log "[build-native] maou-tui-ratatui (release)..."
  Push-Location (Join-Path $Root "cli")
  try {
    npm run build:tui-ratatui
  } catch {
    Die "ratatui build failed"
  }
  Pop-Location
  $ratatuiBin = Join-Path $env:CARGO_TARGET_DIR "release\maou-tui-ratatui.exe"
  if (-not (Test-Path $ratatuiBin)) {
    Die "ratatui binary missing: $ratatuiBin"
  }
  $maouBin = Join-Path $env:USERPROFILE ".maou\bin"
  if (-not (Test-Path $maouBin)) { New-Item -ItemType Directory -Force -Path $maouBin | Out-Null }
  Copy-Item $ratatuiBin (Join-Path $maouBin "maou-tui-ratatui.exe") -Force
  Log "[build-native] ratatui binary copied to $maouBin"
}

Push-Location (Join-Path $Root "cli")
$npOk = $true
try {
  $out = & npm rebuild node-pty 2>&1
  if ($LASTEXITCODE -ne 0) { $npOk = $false; Write-Host "  node-pty rebuild stdout: $out" }
  $out2 = & npm rebuild @lydell/node-pty 2>&1
  if ($LASTEXITCODE -ne 0) { $npOk = $false; Write-Host "  @lydell/node-pty rebuild stdout: $out2" }
} catch { $npOk = $false }
Pop-Location
if ($npOk) {
  Log "[build-native] node-pty rebuild: OK"
} else {
  Log "[build-native] WARNING node-pty rebuild failed - use_terminal will degrade to spawn (Windows: install VS Build Tools + Windows SDK)"
  Log "[build-native]   fix: winget install Microsoft.VisualStudio.2022.BuildTools --override --add Microsoft.VisualStudio.Workload.VCTools"
}

Cleanup-RustCaches
Report-Size
Log "[build-native] done. Next: maou doctor ; maou coding"
Log "Default TUI is Ratatui."
exit 0