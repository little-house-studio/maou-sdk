param(
  [switch]$KeepTarget
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
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { Die "need Rust (cargo not found)" }

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
pnpm add @napi-rs/cli --save-dev
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

$te = Join-Path $Root "terminal-engine"
if (Test-Path $te) {
  Log "[build-native] terminal-engine (napi, release)..."
  Push-Location $te
  try {
    if (-not (Test-Path "node_modules")) {
      npm init -y 2>$null | Out-Null
    }
    npm install @napi-rs/cli --save-dev 2>$null | Out-Null
    npx @napi-rs/cli build --release --platform
  } catch {
    Die "terminal-engine build failed. Install VS Build Tools: winget install Microsoft.VisualStudio.2022.BuildTools --override --wait --add Microsoft.VisualStudio.Workload.VCTools"
  }
  Pop-Location
  $teNode = Join-Path $te "terminal_engine.win32-x64-msvc.node"
  if (-not (Test-Path $teNode)) {
    Die "terminal-engine .node missing: $teNode"
  }
}

$rt = Join-Path $Root "cli\tui-ratatui"
if (Test-Path $rt) {
  Log "[build-native] maou-tui-ratatui (release)..."
  Push-Location (Join-Path $Root "cli")
  try {
    npm run build:tui-ratatui
  } catch {
    Die "ratatui build failed"
  }
  Pop-Location
  $ratatuiBin = Join-Path $Root "cli\dist\maou-tui-ratatui.exe"
  if (-not (Test-Path $ratatuiBin)) {
    Die "ratatui binary missing: $ratatuiBin"
  }
}

Push-Location (Join-Path $Root "cli")
try { npm rebuild node-pty 2>$null } catch {}
try { npm rebuild @lydell/node-pty 2>$null } catch {}
Pop-Location

Cleanup-RustCaches
Report-Size
Log "[build-native] done. Next: maou doctor ; maou coding"
Log "Default TUI is Ratatui."
exit 0