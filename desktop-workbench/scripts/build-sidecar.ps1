$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $root
$spec = Join-Path $root "packaging\econometrics-sidecar.spec"
$dist = Join-Path $root "sidecar-dist"
$work = Join-Path $root "sidecar-build"
$target = Join-Path $dist "econometrics-sidecar"

function Run($cmd, $cmdArgs) {
    & $cmd @cmdArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $cmd $cmdArgs"
    }
}

function PythonVersion($python) {
    $version = & $python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    if ($LASTEXITCODE -ne 0) {
        return $null
    }
    return [version]$version
}

function PickPython {
    $candidates = @()
    if ($env:WORKBENCH_PYTHON) {
        $candidates += $env:WORKBENCH_PYTHON
    }
    $candidates += Join-Path $repoRoot ".venv\Scripts\python.exe"
    $candidates += Join-Path $root ".venv\Scripts\python.exe"

    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate)) {
            continue
        }
        $version = PythonVersion $candidate
        if ($version -and $version -ge [version]"3.10") {
            return $candidate
        }
    }

    throw "Python 3.10+ venv not found. Set WORKBENCH_PYTHON to a suitable python.exe."
}

if (Test-Path -LiteralPath $target) {
    throw "sidecar-dist\econometrics-sidecar already exists. Move it aside or delete it manually before rebuilding."
}

$python = PickPython

Run $python @("-m", "pip", "install", "-r", (Join-Path $root "sidecar\requirements.txt"), "pyinstaller>=6.0")
Run $python @("-m", "PyInstaller", $spec, "--distpath", $dist, "--workpath", $work)

Write-Host "Built sidecar:"
Write-Host (Join-Path $target "econometrics-sidecar.exe")
