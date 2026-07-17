$ErrorActionPreference = "Stop"

function Log([string]$msg) { Write-Host $msg }
function Die([string]$msg) {
  Write-Host "error: $msg" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js not found. Install Node >= 20 from https://nodejs.org then re-run."
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
  Die "Node >= 20 required (found $(node -v))"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Die "npm not found (comes with Node)"
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Die "pnpm required. Install: npm i -g pnpm"
}

$homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
$maouHome = if ($env:MAOU_HOME) { $env:MAOU_HOME } else { Join-Path $homeDir ".maou" }
$binDir = if ($env:MAOU_BIN_DIR) { $env:MAOU_BIN_DIR } else { Join-Path $maouHome "bin" }
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
New-Item -ItemType Directory -Force -Path $maouHome | Out-Null

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$repoRoot = Split-Path -Parent $scriptDir

if (-not (Test-Path (Join-Path $repoRoot "pnpm-workspace.yaml")) -or -not (Test-Path (Join-Path $repoRoot "cli"))) {
  Die "Not a maou-sdk monorepo. Clone the full repo and run install.ps1 from it."
}

Log "[maou] monorepo: $repoRoot"
Log "[maou] building Core (fail-closed)..."

$buildNative = Join-Path $repoRoot "scripts\build-native.ps1"
$coreOk = $false
if (Test-Path $buildNative) {
  try {
    powershell -ExecutionPolicy Bypass -File $buildNative -JsOnly
    $coreOk = $true
  } catch {
    Log "[maou] native incomplete - requiring JS-only success..."
    try {
      powershell -ExecutionPolicy Bypass -File $buildNative -JsOnly
      $coreOk = $true
    } catch {
      Die "JS build failed. Fix errors and re-run. $($_.Exception.Message)"
    }
  }
} else {
  Push-Location $repoRoot
  try {
    pnpm install
    pnpm -r run build
    $coreOk = $true
  } catch {
    Die "pnpm build failed"
  } finally {
    Pop-Location
  }
}

$cliDist = Join-Path $repoRoot "cli\dist\index.js"
if (-not (Test-Path $cliDist)) {
  Die "cli\dist\index.js missing after build - Core incomplete"
}

$wrapCmd = Join-Path $binDir "maou.cmd"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
@"
@echo off
node "$cliDist" %*
"@ | Set-Content -Encoding ASCII $wrapCmd
Log "[maou] wrapper: $wrapCmd"

$ensure = Join-Path $repoRoot "scripts\ensure-dcg.mjs"
if (Test-Path $ensure) {
  Log "[maou] ensuring dcg..."
  try {
    node $ensure --user
  } catch {
    try { node $ensure } catch {
      Log "[maou] WARNING: dcg failed - Terminal security degraded. Later: node scripts\ensure-dcg.mjs --user"
    }
  }
}

$pathParts = $env:Path -split ";"
if ($pathParts -notcontains $binDir) {
  Log ""
  Log "Add to PATH for this session:"
  Log "  `$env:Path = `"$binDir;`" + `$env:Path"
}

Log ""
Log "Install finished with Core ready. Default TUI on Windows is Ratatui."
Log "  maou doctor"
Log "  maou setup"
Log "  maou coding"
Log "If Terminal tier is triangle: scripts\build-native.ps1 (needs Rust + VS Build Tools)"
Log "Done. (Node was not installed by this script.)"