param(
    [switch]$RebuildSidecar,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $root
$appDir = Join-Path $root "app"
$sidecarDir = Join-Path $root "sidecar-dist\econometrics-sidecar"
$sidecarExe = Join-Path $sidecarDir "econometrics-sidecar.exe"
$packageJson = Get-Content (Join-Path $appDir "package.json") | ConvertFrom-Json
$portableExe = Join-Path $appDir "release\Econometrics-Agent-Workbench-$($packageJson.version)-portable.exe"
$rootLauncher = Join-Path $repoRoot "小计.exe"

function Run($cmd, $cmdArgs, $cwd) {
    Push-Location $cwd
    try {
        & $cmd @cmdArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed: $cmd $($cmdArgs -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}

if ($RebuildSidecar -and (Test-Path -LiteralPath $sidecarDir)) {
    throw "sidecar-dist\econometrics-sidecar already exists. Move it aside or delete it manually before rebuilding."
}

if ($RebuildSidecar -or -not (Test-Path -LiteralPath $sidecarExe)) {
    Run "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $root "scripts\build-sidecar.ps1")) $root
}
else {
    Write-Host "Using sidecar:"
    Write-Host $sidecarExe
}

if (-not (Test-Path -LiteralPath $sidecarExe)) {
    throw "Sidecar executable was not found: $sidecarExe"
}

if (-not $SkipNpmInstall -and -not (Test-Path -LiteralPath (Join-Path $appDir "node_modules"))) {
    Run "npm.cmd" @("install") $appDir
}

Run "npm.cmd" @("run", "package:win") $appDir

if (-not (Test-Path -LiteralPath $portableExe)) {
    throw "Portable executable was not found: $portableExe"
}

Copy-Item -LiteralPath $portableExe -Destination $rootLauncher -Force

Write-Host "Built portable app:"
Write-Host $portableExe
Write-Host "Root launcher:"
Write-Host $rootLauncher
