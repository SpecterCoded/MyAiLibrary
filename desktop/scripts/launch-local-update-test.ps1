param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$running = Get-Process -Name 'MyAiLibrary' -ErrorAction SilentlyContinue
if ($running) {
    throw 'MyAiLibrary is already running. Close it completely, then run this command again.'
}

$shortcutLocations = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MyAiLibrary.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'MyAiLibrary.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MyAiLibrary.lnk'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\MyAiLibrary.lnk')
)
$shell = New-Object -ComObject WScript.Shell
$executable = $null

foreach ($shortcutPath in $shortcutLocations) {
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { continue }
    $candidate = $shell.CreateShortcut($shortcutPath).TargetPath
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $executable = $candidate
        break
    }
}

if (-not $executable) {
    $programsRoot = Join-Path $env:LOCALAPPDATA 'Programs'
    $candidate = Get-ChildItem -LiteralPath $programsRoot -Filter 'MyAiLibrary.exe' -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($candidate) { $executable = $candidate.FullName }
}

if (-not $executable) {
    throw 'Could not find the installed MyAiLibrary.exe. Reinstall the engineering 0.1.2 package, then try again.'
}

$env:MYAI_ENABLE_TEST_UPDATES = '1'
$env:MYAI_LOCAL_UPDATE_URL = "http://127.0.0.1:$Port"
Write-Host "Launching engineering updater from: $executable"
Write-Host "Local update feed: $env:MYAI_LOCAL_UPDATE_URL"
Start-Process -FilePath $executable
