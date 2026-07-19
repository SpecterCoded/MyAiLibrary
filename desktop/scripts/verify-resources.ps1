$ErrorActionPreference = "Stop"
$ffmpeg = Join-Path $PSScriptRoot "..\vendor\ffmpeg\ffmpeg.exe"
$ffprobe = Join-Path $PSScriptRoot "..\vendor\ffmpeg\ffprobe.exe"
$ffmpegLicense = Join-Path $PSScriptRoot "..\vendor\ffmpeg\LICENSE-FFMPEG.txt"
$backend = Join-Path $PSScriptRoot "..\..\backend\dist\myailibrary-backend\myailibrary-backend.exe"
$ui = Join-Path $PSScriptRoot "..\..\frontend\dist\index.html"

foreach ($required in @($ffmpeg, $ffprobe, $ffmpegLicense, $backend, $ui)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required packaging resource missing: $required" }
}
Write-Host "Desktop packaging resources are present."
