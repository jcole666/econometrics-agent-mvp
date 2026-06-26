param(
    [switch]$RebuildSidecar,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $root "desktop-app\scripts\package-windows.ps1"
$argsList = @()

if ($RebuildSidecar) {
    $argsList += "-RebuildSidecar"
}

if ($SkipNpmInstall) {
    $argsList += "-SkipNpmInstall"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script @argsList
