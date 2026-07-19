$ErrorActionPreference = "Stop"
$targets = @(
    (Join-Path $PSScriptRoot "..\dist"),
    (Join-Path $PSScriptRoot "..\release")
)
foreach ($target in $targets) {
    $resolvedParent = (Resolve-Path -LiteralPath (Split-Path -Parent $target)).Path
    $candidate = [System.IO.Path]::GetFullPath($target)
    if ($candidate.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $candidate)) {
        Remove-Item -LiteralPath $candidate -Recurse -Force
    }
}
