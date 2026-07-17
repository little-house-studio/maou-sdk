param(
  [switch]$SkipRatatui,
  [switch]$JsOnly,
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

if ($JsOnly) {
  Cleanup-RustCaches
  Report-Size
  Log "[build-native] -JsOnly done (Core OK)"
  exit 0
}

$ensure = Join-Path $Root "scripts\ensure-dcg.mjs"
if (Test-Path $ensure) {
  Log "[build-native] dcg..."
  try { node $ensure } catch { Log "[build-native] dcg failed (non-fatal)" }
}

$te = Join-Path $Root "terminal-engine"
if (Test-Path $te) {
  if (Get-Command cargo -ErrorAction SilentlyContinue) {
    Log "[build-native] terminal-engine (napi, release)..."
    Push-Location $te
    try {
      npx --yes @napi-rs/cli build --release --platform
    } catch {
      Log "[build-native] terminal-engine failed - VS Build Tools + rustup MSVC"
    }
    Pop-Location
  } else {
    Log "[build-native] skip terminal-engine: install Rust"
  }
}

if (-not $SkipRatatui) {
  $rt = Join-Path $Root "cli\tui-ratatui"
  if ((Test-Path $rt) -and (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Log "[build-native] maou-tui-ratatui (release)..."
    Push-Location (Join-Path $Root "cli")
    try { npm run build:tui-ratatui } catch { Log "[build-native] ratatui failed - use MAOU_TUI=ink" }
    Pop-Location
  }
}

Push-Location (Join-Path $Root "cli")
try { npm rebuild node-pty 2>$null } catch {}
try { npm rebuild @lydell/node-pty 2>$null } catch {}
Pop-Location

Cleanup-RustCaches
Report-Size
Log "[build-native] done. Next: maou doctor ; maou coding"
Log "Windows default TUI is Ink."