$ErrorActionPreference = "Stop"

$vendorRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\vendor\ffmpeg"))
$archive = Join-Path $vendorRoot "ffmpeg-win64-lgpl.zip"
$expanded = Join-Path $vendorRoot "expanded"
$url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip"
$expectedFfmpeg = "00215BDA52CF0A318701B66B80890629C75B626E15E74B936653797A38E924A6"
$expectedFfprobe = "D559AA49FD5924B45BE017C13F787EC21C58A97A35AD8D01A0C66B0A38500926"

New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
& curl.exe --location --fail --retry 20 --retry-delay 3 --retry-all-errors --continue-at - --output $archive $url
if ($LASTEXITCODE -ne 0) { throw "FFmpeg download failed with exit code $LASTEXITCODE." }

if (Test-Path -LiteralPath $expanded) {
    $resolvedExpanded = [System.IO.Path]::GetFullPath($expanded)
    if (-not $resolvedExpanded.StartsWith($vendorRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean an extraction path outside the FFmpeg vendor directory."
    }
    Remove-Item -LiteralPath $resolvedExpanded -Recurse -Force
}
Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force

$bundle = Get-ChildItem -LiteralPath $expanded -Directory | Select-Object -First 1
if (-not $bundle) { throw "The FFmpeg archive did not contain a bundle directory." }
Copy-Item -LiteralPath (Join-Path $bundle.FullName "bin\ffmpeg.exe") -Destination (Join-Path $vendorRoot "ffmpeg.exe") -Force
Copy-Item -LiteralPath (Join-Path $bundle.FullName "bin\ffprobe.exe") -Destination (Join-Path $vendorRoot "ffprobe.exe") -Force
Copy-Item -LiteralPath (Join-Path $bundle.FullName "LICENSE.txt") -Destination (Join-Path $vendorRoot "LICENSE-FFMPEG.txt") -Force

$actualFfmpeg = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $vendorRoot "ffmpeg.exe")).Hash
$actualFfprobe = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $vendorRoot "ffprobe.exe")).Hash
if ($actualFfmpeg -ne $expectedFfmpeg -or $actualFfprobe -ne $expectedFfprobe) {
    throw "Downloaded FFmpeg build differs from the pinned 2026-07-18 engineering build. Review and update the pinned hashes intentionally."
}

Write-Host "Pinned Windows x64 LGPL FFmpeg resources are ready."
