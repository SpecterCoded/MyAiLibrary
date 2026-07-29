param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("staged-install", "public-discovery")]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$ReleaseDirectory,

    [string]$PreviousVersion = "0.1.0-beta.6",

    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion,

    [ValidateRange(1024, 65535)]
    [int]$FeedPort = 8788,

    [ValidateRange(1024, 65535)]
    [int]$RemoteDebuggingPort = 9331
)

$ErrorActionPreference = "Stop"
$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repositoryRoot = (Resolve-Path (Join-Path $desktopRoot "..")).Path
$resolvedReleaseDirectory = (Resolve-Path -LiteralPath $ReleaseDirectory -ErrorAction Stop).Path
$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$cacheRoot = Join-Path $temporaryRoot "myailibrary-release-cache"
$previousInstaller = Join-Path $cacheRoot "MyAI-Library-Setup-$PreviousVersion-x64.exe"
$previousInstallerUrl = "https://github.com/SpecterCoded/MyAiLibrary/releases/download/v$PreviousVersion/MyAI-Library-Setup-$PreviousVersion-x64.exe"
$previousChecksumUrl = "https://github.com/SpecterCoded/MyAiLibrary/releases/download/v$PreviousVersion/SHA256SUMS.txt"
$testRoot = Join-Path $temporaryRoot ("myailibrary-update-smoke-" + $Mode + "-" + [guid]::NewGuid().ToString("N"))
$installRoot = Join-Path $testRoot "application"
$chromiumData = Join-Path $testRoot "chromium"
$localAppData = Join-Path $testRoot "local-app-data"
$feedRoot = Join-Path $testRoot "feed"
$stdoutPath = Join-Path $testRoot "stdout.log"
$stderrPath = Join-Path $testRoot "stderr.log"
$preservationPath = Join-Path $localAppData "MyAILibrary\update-preservation.txt"
$asarTool = Join-Path $desktopRoot "node_modules\@electron\asar\bin\asar.js"
$appProcess = $null
$feedProcess = $null
$previousLocalAppData = $env:LOCALAPPDATA
$previousTestUpdates = $env:MYAI_ENABLE_TEST_UPDATES
$previousLocalFeed = $env:MYAI_LOCAL_UPDATE_URL
$succeeded = $false

New-Item -ItemType Directory -Force -Path $cacheRoot, $testRoot, $chromiumData, $localAppData | Out-Null

function Invoke-CdpCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WebSocketUrl,

        [Parameter(Mandatory = $true)]
        [hashtable]$Message,

        [ValidateRange(5, 1800)]
        [int]$TimeoutSeconds = 120
    )

    $socket = [Net.WebSockets.ClientWebSocket]::new()
    try {
        $socket.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $json = $Message | ConvertTo-Json -Depth 12 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $socket.SendAsync(
            [ArraySegment[byte]]::new($bytes),
            [Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            [Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()

        $cancellation = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSeconds))
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
                        if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
                            throw "The application closed its DevTools connection."
                        }
                        $stream.Write($buffer, 0, $received.Count)
                    } while (-not $received.EndOfMessage)
                    $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
                    if ($response.id -eq $Message.id) { return $response }
                } finally {
                    $stream.Dispose()
                }
            }
            throw "Timed out waiting for Chrome DevTools response $($Message.id)."
        } finally {
            $cancellation.Dispose()
        }
    } finally {
        $socket.Dispose()
    }
}

function Wait-PageTarget {
    param(
        [Parameter(Mandatory = $true)]
        [Diagnostics.Process]$Process,

        [Parameter(Mandatory = $true)]
        [int]$Port,

        [ValidateRange(10, 180)]
        [int]$TimeoutSeconds = 60
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) {
            throw "MyAiLibrary exited before its renderer became available."
        }
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 2
            $page = @(
                $targets | Where-Object {
                    $_.type -eq "page" -and $_.url -match "^http://127\.0\.0\.1:"
                }
            )[0]
            if ($page) { return $page }
        } catch {
            Start-Sleep -Milliseconds 400
        }
    }
    throw "MyAiLibrary did not expose a renderer within $TimeoutSeconds seconds."
}

function Wait-DesktopUpdateBridge {
    param(
        [Parameter(Mandatory = $true)]
        [Diagnostics.Process]$Process,

        [Parameter(Mandatory = $true)]
        [string]$WebSocketUrl,

        [ValidateRange(10, 180)]
        [int]$TimeoutSeconds = 60
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $attempt = 0
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) {
            throw "MyAiLibrary exited before its update bridge became available."
        }
        $attempt += 1
        try {
            $response = Invoke-CdpCommand -WebSocketUrl $WebSocketUrl -Message @{
                id = 1000 + $attempt
                method = "Runtime.evaluate"
                params = @{
                    expression = @'
Boolean(
  window.desktop &&
  typeof window.desktop.getVersion === 'function' &&
  typeof window.desktop.getUpdateState === 'function' &&
  typeof window.desktop.setUpdatePreferences === 'function' &&
  typeof window.desktop.checkForUpdates === 'function' &&
  typeof window.desktop.downloadUpdate === 'function' &&
  typeof window.desktop.installUpdate === 'function'
)
'@
                    returnByValue = $true
                }
            } -TimeoutSeconds 10
            if (
                -not $response.result.exceptionDetails -and
                $response.result.result.value -eq $true
            ) {
                return
            }
        } catch {
            # The renderer target can exist briefly before preload exposes the
            # desktop bridge. Retry until the bounded readiness deadline.
        }
        Start-Sleep -Milliseconds 400
    }
    throw "MyAiLibrary did not expose its update bridge within $TimeoutSeconds seconds."
}

function Stop-IsolatedProcesses {
    $targets = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -and (
                    $_.CommandLine.Contains($installRoot) -or
                    $_.CommandLine.Contains($chromiumData) -or
                    $_.CommandLine.Contains($localAppData)
                )
            }
    )
    foreach ($target in $targets) {
        Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Get-PackagedVersion {
    param([Parameter(Mandatory = $true)][string]$ArchivePath)
    $script = "const a=require(process.argv[1]);process.stdout.write(a.extractFile(process.argv[2],'package.json').toString())"
    $packageJson = & node -e $script (Join-Path $desktopRoot "node_modules\@electron\asar") $ArchivePath
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect the packaged application version." }
    return [string](($packageJson | Out-String | ConvertFrom-Json).version)
}

try {
    if (-not (Test-Path -LiteralPath $asarTool -PathType Leaf)) {
        throw "The Electron ASAR tool is missing. Run npm ci in desktop first."
    }
    $checksumPath = Join-Path $cacheRoot "SHA256SUMS-$PreviousVersion.txt"
    Invoke-WebRequest -Uri $previousChecksumUrl -OutFile $checksumPath -TimeoutSec 60
    $checksumText = Get-Content -LiteralPath $checksumPath -Raw -Encoding utf8
    $checksumPattern = "(?im)^(?<hash>[0-9a-f]{64})\s+\*?MyAI-Library-Setup-$([Regex]::Escape($PreviousVersion))-x64\.exe\s*$"
    $checksumMatch = [Regex]::Match($checksumText, $checksumPattern)
    if (-not $checksumMatch.Success) {
        throw "The public Beta 6 checksum file does not contain the expected installer."
    }
    $expectedPreviousHash = $checksumMatch.Groups["hash"].Value.ToLowerInvariant()
    $cachedInstallerValid = $false
    if (Test-Path -LiteralPath $previousInstaller -PathType Leaf) {
        $cachedInstallerHash = (Get-FileHash -LiteralPath $previousInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
        $cachedInstallerValid = $cachedInstallerHash -eq $expectedPreviousHash
    }
    if (-not $cachedInstallerValid) {
        Remove-Item -LiteralPath $previousInstaller -Force -ErrorAction SilentlyContinue
        Write-Host "Downloading the public Beta 6 installer once for isolated update validation."
        Invoke-WebRequest -Uri $previousInstallerUrl -OutFile $previousInstaller -TimeoutSec 1800
    }
    $downloadedPreviousHash = (Get-FileHash -LiteralPath $previousInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($downloadedPreviousHash -ne $expectedPreviousHash) {
        throw "The cached public Beta 6 installer does not match its published SHA-256 checksum."
    }

    $installer = Start-Process `
        -FilePath $previousInstaller `
        -ArgumentList @("/S", "/D=$installRoot") `
        -WindowStyle Hidden `
        -PassThru `
        -Wait
    if ($installer.ExitCode -ne 0) {
        throw "Beta 6 isolated installation failed with exit code $($installer.ExitCode)."
    }

    $installedExecutable = Join-Path $installRoot "MyAILibrary.exe"
    $installedAsar = Join-Path $installRoot "resources\app.asar"
    if (
        -not (Test-Path -LiteralPath $installedExecutable -PathType Leaf) -or
        -not (Test-Path -LiteralPath $installedAsar -PathType Leaf)
    ) {
        throw "The isolated Beta 6 application was not installed correctly."
    }
    if ((Get-PackagedVersion -ArchivePath $installedAsar) -ne $PreviousVersion) {
        throw "The isolated previous installation does not report $PreviousVersion."
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $preservationPath -Parent) | Out-Null
    Set-Content -LiteralPath $preservationPath -Value "preserve-through-update" -Encoding utf8
    $env:LOCALAPPDATA = $localAppData

    if ($Mode -eq "staged-install") {
        New-Item -ItemType Directory -Force -Path $feedRoot | Out-Null
        $installerName = "MyAI-Library-Setup-$ExpectedVersion-x64.exe"
        $expectedFeedFiles = @(
            $installerName,
            "$installerName.blockmap",
            "beta.yml"
        )
        foreach ($name in $expectedFeedFiles) {
            $source = Join-Path $resolvedReleaseDirectory $name
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
                throw "Staged update feed is missing $name."
            }
            Copy-Item -LiteralPath $source -Destination (Join-Path $feedRoot $name) -Force
        }
        Copy-Item -LiteralPath (Join-Path $resolvedReleaseDirectory "beta.yml") -Destination (Join-Path $feedRoot "stable.yml") -Force

        # Beta 6's production code already supports a loopback-only engineering
        # feed, but release packages keep the switch disabled. Change only that
        # package policy in this isolated copy; application code stays byte-for-byte
        # identical to the public Beta 6 installer.
        $asarExtract = Join-Path $testRoot "asar-extracted"
        & node $asarTool extract $installedAsar $asarExtract
        if ($LASTEXITCODE -ne 0) { throw "Could not extract the isolated Beta 6 application archive." }
        $packagePath = Join-Path $asarExtract "package.json"
        $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
        $package.updatesTestMode = $true
        $packageJson = $package | ConvertTo-Json -Depth 20
        [IO.File]::WriteAllText($packagePath, $packageJson, [Text.UTF8Encoding]::new($false))
        $repackedAsar = Join-Path $testRoot "app-repacked.asar"
        & node $asarTool pack $asarExtract $repackedAsar
        if ($LASTEXITCODE -ne 0) { throw "Could not repack the isolated Beta 6 application archive." }
        Move-Item -LiteralPath $repackedAsar -Destination $installedAsar -Force

        $python = (Get-Command python -ErrorAction Stop).Source
        $feedProcess = Start-Process `
            -FilePath $python `
            -ArgumentList @("-m", "http.server", "$FeedPort", "--bind", "127.0.0.1", "--directory", $feedRoot) `
            -WindowStyle Hidden `
            -PassThru
        $feedDeadline = [DateTime]::UtcNow.AddSeconds(20)
        $feedReady = $false
        while ([DateTime]::UtcNow -lt $feedDeadline) {
            if ($feedProcess.HasExited) { throw "The staged update feed stopped unexpectedly." }
            try {
                Invoke-WebRequest -Uri "http://127.0.0.1:$FeedPort/stable.yml" -UseBasicParsing -TimeoutSec 2 | Out-Null
                $feedReady = $true
                break
            } catch {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $feedReady) {
            throw "The staged update feed did not become reachable within 20 seconds."
        }
        $env:MYAI_ENABLE_TEST_UPDATES = "1"
        $env:MYAI_LOCAL_UPDATE_URL = "http://127.0.0.1:$FeedPort"
    } else {
        Remove-Item Env:MYAI_ENABLE_TEST_UPDATES -ErrorAction SilentlyContinue
        Remove-Item Env:MYAI_LOCAL_UPDATE_URL -ErrorAction SilentlyContinue
    }

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
    $pageTarget = Wait-PageTarget -Process $appProcess -Port $RemoteDebuggingPort
    Wait-DesktopUpdateBridge -Process $appProcess -WebSocketUrl $pageTarget.webSocketDebuggerUrl

    $expectedVersionJson = $ExpectedVersion | ConvertTo-Json -Compress
    $stateExpression = @'
(async () => {
  const expectedVersion = __EXPECTED_VERSION__;
  const preferences = await window.desktop.setUpdatePreferences({
    channel: 'testing',
    automaticallyCheck: false,
    automaticallyDownload: false
  });
  const waitFor = async (accepted, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let state = await window.desktop.getUpdateState();
    while (!accepted.includes(state?.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await window.desktop.getUpdateState();
    }
    return state;
  };
  await window.desktop.checkForUpdates();
  const discovered = await waitFor(['available', 'error', 'up-to-date'], 120000);
  return {
    preferences,
    discovered,
    expectedVersion,
    currentVersion: await window.desktop.getVersion()
  };
})()
'@.Replace("__EXPECTED_VERSION__", $expectedVersionJson)
    $discoveryResponse = Invoke-CdpCommand -WebSocketUrl $pageTarget.webSocketDebuggerUrl -Message @{
        id = 1
        method = "Runtime.evaluate"
        params = @{
            expression = $stateExpression
            awaitPromise = $true
            returnByValue = $true
        }
    } -TimeoutSeconds 180
    if ($discoveryResponse.result.exceptionDetails) {
        $exceptionSummary = $discoveryResponse.result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress
        throw "Beta 6 update discovery raised a renderer exception: $exceptionSummary"
    }
    $discovery = $discoveryResponse.result.result.value
    if (
        $discovery.currentVersion -ne $PreviousVersion -or
        $discovery.preferences.channel -ne "testing" -or
        $discovery.discovered.status -ne "available" -or
        $discovery.discovered.availableVersion -ne $ExpectedVersion
    ) {
        $summary = $discovery | ConvertTo-Json -Depth 8 -Compress
        throw "Beta 6 did not discover the expected Testing-channel update. State: $summary"
    }

    if ($Mode -eq "public-discovery") {
        Write-Host "Public Beta 6 Testing-channel discovery of $ExpectedVersion passed."
        $succeeded = $true
        return
    }

    $downloadExpression = @'
(async () => {
  const waitFor = async (accepted, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let state = await window.desktop.getUpdateState();
    while (!accepted.includes(state?.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      state = await window.desktop.getUpdateState();
    }
    return state;
  };
  const before = await window.desktop.getUpdateState();
  await window.desktop.downloadUpdate();
  const ready = await waitFor(['ready-to-install', 'error'], 900000);
  return { before, ready };
})()
'@
    $downloadResponse = Invoke-CdpCommand -WebSocketUrl $pageTarget.webSocketDebuggerUrl -Message @{
        id = 2
        method = "Runtime.evaluate"
        params = @{
            expression = $downloadExpression
            awaitPromise = $true
            returnByValue = $true
        }
    } -TimeoutSeconds 960
    if ($downloadResponse.result.exceptionDetails) {
        throw "Beta 7 download raised a renderer exception."
    }
    $download = $downloadResponse.result.result.value
    if (
        $download.before.status -ne "available" -or
        $download.ready.status -ne "ready-to-install" -or
        $download.ready.availableVersion -ne $ExpectedVersion -or
        [double]$download.ready.percent -lt 100
    ) {
        $summary = $download | ConvertTo-Json -Depth 8 -Compress
        throw "The staged update did not reach ready-to-install. State: $summary"
    }

    $installResponse = Invoke-CdpCommand -WebSocketUrl $pageTarget.webSocketDebuggerUrl -Message @{
        id = 3
        method = "Runtime.evaluate"
        params = @{
            expression = "setTimeout(() => void window.desktop.installUpdate(), 100); true"
            returnByValue = $true
        }
    } -TimeoutSeconds 30
    if ($installResponse.result.exceptionDetails -or $installResponse.result.result.value -ne $true) {
        throw "The updater bridge did not accept the Beta 7 install request."
    }

    $updateDeadline = [DateTime]::UtcNow.AddMinutes(8)
    $installedVersion = ""
    while ([DateTime]::UtcNow -lt $updateDeadline) {
        Start-Sleep -Seconds 2
        if (Test-Path -LiteralPath $installedAsar -PathType Leaf) {
            try {
                $installedVersion = Get-PackagedVersion -ArchivePath $installedAsar
                if ($installedVersion -eq $ExpectedVersion) { break }
            } catch {
                # The archive can be temporarily unavailable while NSIS replaces it.
            }
        }
    }
    if ($installedVersion -ne $ExpectedVersion) {
        throw "The isolated installation did not advance to $ExpectedVersion."
    }

    Start-Sleep -Seconds 8
    Stop-IsolatedProcesses
    $appProcess = $null
    $postUpdateChromium = Join-Path $testRoot "chromium-after-update"
    New-Item -ItemType Directory -Force -Path $postUpdateChromium | Out-Null
    $postUpdatePort = $RemoteDebuggingPort + 1
    $appProcess = Start-Process `
        -FilePath $installedExecutable `
        -ArgumentList @(
            "--remote-debugging-port=$postUpdatePort",
            "--user-data-dir=$postUpdateChromium",
            "--disable-gpu"
        ) `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru
    $updatedTarget = Wait-PageTarget -Process $appProcess -Port $postUpdatePort
    $versionResponse = Invoke-CdpCommand -WebSocketUrl $updatedTarget.webSocketDebuggerUrl -Message @{
        id = 4
        method = "Runtime.evaluate"
        params = @{
            expression = "(async () => ({ version: await window.desktop.getVersion(), state: await window.desktop.getUpdateState() }))()"
            awaitPromise = $true
            returnByValue = $true
        }
    } -TimeoutSeconds 60
    if ($versionResponse.result.exceptionDetails) {
        throw "The updated Beta 7 renderer raised an exception."
    }
    $updated = $versionResponse.result.result.value
    if ($updated.version -ne $ExpectedVersion) {
        throw "The restarted application reports '$($updated.version)' instead of $ExpectedVersion."
    }
    if (
        -not (Test-Path -LiteralPath $preservationPath -PathType Leaf) -or
        (Get-Content -LiteralPath $preservationPath -Raw).Trim() -ne "preserve-through-update"
    ) {
        throw "The Beta 6 to Beta 7 update did not preserve isolated application data."
    }

    Write-Host "Beta 6 to Beta 7 discovery, download, ready state, installation, restart, version, and data-preservation checks passed."
    $succeeded = $true
} catch {
    Write-Warning "Update smoke-test logs were retained at $testRoot"
    throw
} finally {
    $env:LOCALAPPDATA = $previousLocalAppData
    if ($null -eq $previousTestUpdates) {
        Remove-Item Env:MYAI_ENABLE_TEST_UPDATES -ErrorAction SilentlyContinue
    } else {
        $env:MYAI_ENABLE_TEST_UPDATES = $previousTestUpdates
    }
    if ($null -eq $previousLocalFeed) {
        Remove-Item Env:MYAI_LOCAL_UPDATE_URL -ErrorAction SilentlyContinue
    } else {
        $env:MYAI_LOCAL_UPDATE_URL = $previousLocalFeed
    }
    if ($appProcess -and -not $appProcess.HasExited) {
        Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Stop-IsolatedProcesses
    if ($feedProcess -and -not $feedProcess.HasExited) {
        Stop-Process -Id $feedProcess.Id -Force -ErrorAction SilentlyContinue
    }
    $uninstaller = Join-Path $installRoot "Uninstall MyAiLibrary.exe"
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        try {
            Start-Process -FilePath $uninstaller -ArgumentList "/S" -WindowStyle Hidden -Wait
        } catch {
            Write-Warning "The isolated update installation could not be uninstalled automatically."
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
