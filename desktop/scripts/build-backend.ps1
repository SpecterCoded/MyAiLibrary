$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$backendDir = Join-Path $repoRoot "backend"
$venvPython = Join-Path $backendDir "venv\Scripts\python.exe"
$spec = Join-Path $backendDir "desktop_backend.spec"
$dist = Join-Path $backendDir "dist"
$work = Join-Path $repoRoot "desktop\.pyinstaller"

if (Test-Path -LiteralPath $venvPython) {
    $python = $venvPython
} else {
    $pythonCommand = Get-Command python -CommandType Application -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw "No Python executable was found. Create backend\venv or provide Python on PATH."
    }
    $python = $pythonCommand.Source
}

& $python -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller is not installed for $python. Install backend\requirements-build.txt in that Python environment."
}

Push-Location $backendDir
try {
    & $python -m PyInstaller --noconfirm --clean --distpath $dist --workpath $work $spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
