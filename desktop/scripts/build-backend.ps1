$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$backendDir = Join-Path $repoRoot "backend"
$python = Join-Path $backendDir "venv\Scripts\python.exe"
$spec = Join-Path $backendDir "desktop_backend.spec"
$dist = Join-Path $backendDir "dist"
$work = Join-Path $repoRoot "desktop\.pyinstaller"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Backend Python environment not found at $python"
}

& $python -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller is not installed. Run: backend\venv\Scripts\python.exe -m pip install -r backend\requirements-build.txt"
}

Push-Location $backendDir
try {
    & $python -m PyInstaller --noconfirm --clean --distpath $dist --workpath $work $spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
