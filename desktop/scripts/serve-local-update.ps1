param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$')]
    [string]$Version,

    [ValidateRange(1024, 65535)]
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryRoot = (Resolve-Path (Join-Path $desktopRoot '..')).Path
$releaseDirectory = Join-Path $desktopRoot "release-local\$Version"
$metadataPath = Join-Path $releaseDirectory 'stable.yml'
$pythonPath = Join-Path $repositoryRoot 'backend\venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
    throw "Missing $metadataPath. Build the engineering update first."
}
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    throw "Python environment was not found at $pythonPath."
}

Write-Host "Serving My AI Library engineering update $Version"
Write-Host "Feed URL: http://127.0.0.1:$Port"
Write-Host 'Keep this terminal open during the update test. Press Ctrl+C to stop.'
& $pythonPath -m http.server $Port --bind 127.0.0.1 --directory $releaseDirectory
