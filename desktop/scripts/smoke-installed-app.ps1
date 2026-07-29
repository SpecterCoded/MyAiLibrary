param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion,

    [ValidateRange(1024, 65535)]
    [int]$RemoteDebuggingPort = 9324
)

$ErrorActionPreference = "Stop"
$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).Path
$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$testRoot = Join-Path $temporaryRoot ("myailibrary-installed-smoke-" + [guid]::NewGuid().ToString("N"))
$installRoot = Join-Path $testRoot "application"
$chromiumData = Join-Path $testRoot "chromium"
$localAppData = Join-Path $testRoot "local-app-data"
$stdoutPath = Join-Path $testRoot "stdout.log"
$stderrPath = Join-Path $testRoot "stderr.log"
$appProcess = $null
$previousLocalAppData = $env:LOCALAPPDATA
$succeeded = $false

New-Item -ItemType Directory -Path $testRoot, $chromiumData, $localAppData | Out-Null

try {
    $installer = Start-Process `
        -FilePath $resolvedInstaller `
        -ArgumentList @("/S", "/D=$installRoot") `
        -WindowStyle Hidden `
        -PassThru `
        -Wait
    if ($installer.ExitCode -ne 0) {
        throw "NSIS silent installation failed with exit code $($installer.ExitCode)."
    }

    $installedExecutable = Join-Path $installRoot "MyAILibrary.exe"
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
        throw "The installed application executable was not found at $installedExecutable."
    }
    $installedVersion = (Get-Item -LiteralPath $installedExecutable).VersionInfo.ProductVersion
    if (-not $installedVersion -or $installedVersion -notlike "$ExpectedVersion*") {
        throw "Installed executable version '$installedVersion' does not match $ExpectedVersion."
    }

    $env:LOCALAPPDATA = $localAppData
    $appProcess = Start-Process `
        -FilePath $installedExecutable `
        -ArgumentList @(
            "--remote-debugging-port=$RemoteDebuggingPort",
            "--user-data-dir=$chromiumData",
            "--disable-gpu"
        ) `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    $pageTarget = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($appProcess.HasExited) {
            throw "Installed application exited before its renderer became available."
        }
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$RemoteDebuggingPort/json" -TimeoutSec 2
            $pageTarget = @(
                $targets | Where-Object {
                    $_.type -eq "page" -and $_.url -match "^http://127\.0\.0\.1:"
                }
            )[0]
            if ($pageTarget) { break }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $pageTarget) {
        throw "Installed application did not expose its renderer within 60 seconds."
    }

    $backendProcesses = @(
        Get-CimInstance Win32_Process -Filter "Name='myailibrary-backend.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains($localAppData) }
    )
    if ($backendProcesses.Count -ne 1) {
        throw "Expected one installed backend process, found $($backendProcesses.Count)."
    }

    Write-Host "NSIS installation, version, renderer startup, and single backend process checks passed."
    $succeeded = $true
} catch {
    Write-Warning "Installed-app smoke-test logs were retained at $testRoot"
    throw
} finally {
    $env:LOCALAPPDATA = $previousLocalAppData
    if ($appProcess -and -not $appProcess.HasExited) {
        Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='myailibrary-backend.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($localAppData) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    $uninstaller = Join-Path $installRoot "Uninstall MyAiLibrary.exe"
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        try {
            Start-Process -FilePath $uninstaller -ArgumentList "/S" -WindowStyle Hidden -Wait
        } catch {
            Write-Warning "The isolated test installation could not be uninstalled automatically."
        }
    }
    if ($succeeded -and (Test-Path -LiteralPath $testRoot)) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
        if ($resolvedTestRoot.StartsWith($resolvedTemporaryRoot + [IO.Path]::DirectorySeparatorChar)) {
            Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
