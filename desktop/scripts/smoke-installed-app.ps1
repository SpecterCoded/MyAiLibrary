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

function Invoke-CdpCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WebSocketUrl,

        [Parameter(Mandatory = $true)]
        [hashtable]$Message
    )

    $socket = [Net.WebSockets.ClientWebSocket]::new()
    try {
        $socket.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $json = $Message | ConvertTo-Json -Depth 8 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $socket.SendAsync(
            [ArraySegment[byte]]::new($bytes),
            [Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            [Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()

        $cancellation = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(30))
        try {
            while (-not $cancellation.IsCancellationRequested) {
                $buffer = New-Object byte[] 65536
                $stream = [IO.MemoryStream]::new()
                try {
                    do {
                        $received = $socket.ReceiveAsync(
                            [ArraySegment[byte]]::new($buffer),
                            $cancellation.Token
                        ).GetAwaiter().GetResult()
                        $stream.Write($buffer, 0, $received.Count)
                    } while (-not $received.EndOfMessage)
                    $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
                    if ($response.id -eq $Message.id) { return $response }
                } finally {
                    $stream.Dispose()
                }
            }
            throw "Timed out waiting for installed-app CDP response."
        } finally {
            $cancellation.Dispose()
        }
    } finally {
        $socket.Dispose()
    }
}

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

    $installedExecutable = Join-Path $installRoot "MyAiLibrary.exe"
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
        throw "The installed application executable was not found at $installedExecutable."
    }
    $installedVersion = (Get-Item -LiteralPath $installedExecutable).VersionInfo.ProductVersion
    $expectedWindowsVersionPrefix = ($ExpectedVersion -split "-", 2)[0]
    if (-not $installedVersion -or $installedVersion -notlike "$expectedWindowsVersionPrefix.*") {
        throw "Installed executable Windows version '$installedVersion' does not match $expectedWindowsVersionPrefix."
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

    $versionResponse = Invoke-CdpCommand -WebSocketUrl $pageTarget.webSocketDebuggerUrl -Message @{
        id = 1
        method = "Runtime.evaluate"
        params = @{
            expression = "(async () => await window.desktop?.getVersion?.())()"
            awaitPromise = $true
            returnByValue = $true
        }
    }
    if ($versionResponse.result.exceptionDetails) {
        throw "Installed application version bridge raised an exception."
    }
    $applicationVersion = [string]$versionResponse.result.result.value
    if ($applicationVersion -ne $ExpectedVersion) {
        throw "Installed application reports version '$applicationVersion' instead of $ExpectedVersion."
    }

    $backendProcesses = @(
        Get-CimInstance Win32_Process -Filter "Name='myailibrary-backend.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains($localAppData) }
    )
    if ($backendProcesses.Count -ne 1) {
        throw "Expected one installed backend process, found $($backendProcesses.Count)."
    }

    Write-Host "NSIS installation, application version, renderer startup, and single backend process checks passed."
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
