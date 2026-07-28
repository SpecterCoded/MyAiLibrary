param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [int]$RemoteDebuggingPort = 9323,

    [string]$ApplicationPath = ""
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$testRoot = Join-Path $temporaryRoot ("myailibrary-packaged-smoke-" + [guid]::NewGuid().ToString("N"))
$chromiumData = Join-Path $testRoot "chromium"
$localAppData = Join-Path $testRoot "local-app-data"
$stdoutPath = Join-Path $testRoot "stdout.log"
$stderrPath = Join-Path $testRoot "stderr.log"
New-Item -ItemType Directory -Path $chromiumData, $localAppData | Out-Null

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
        $json = $Message | ConvertTo-Json -Depth 12 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $segment = [ArraySegment[byte]]::new($bytes)
        $socket.SendAsync(
            $segment,
            [Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            [Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()

        $cancellation = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(75))
        try {
            while (-not $cancellation.IsCancellationRequested) {
                $buffer = New-Object byte[] 65536
                $stream = [IO.MemoryStream]::new()
                try {
                    do {
                        $receiveSegment = [ArraySegment[byte]]::new($buffer)
                        $received = $socket.ReceiveAsync(
                            $receiveSegment,
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
            throw "Timed out waiting for Chrome DevTools response $($Message.id)."
        } finally {
            $cancellation.Dispose()
        }
    } finally {
        if ($socket.State -eq [Net.WebSockets.WebSocketState]::Open) {
            try {
                $socket.CloseAsync(
                    [Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
                    "Smoke test complete",
                    [Threading.CancellationToken]::None
                ).GetAwaiter().GetResult()
            } catch {
                # Process cleanup below remains authoritative.
            }
        }
        $socket.Dispose()
    }
}

$previousLocalAppData = $env:LOCALAPPDATA
$appProcess = $null
$smokeSucceeded = $false
try {
    $env:LOCALAPPDATA = $localAppData
    $arguments = @(
        "--remote-debugging-port=$RemoteDebuggingPort",
        "--user-data-dir=$chromiumData",
        "--disable-gpu",
        "--enable-logging=stderr"
    )
    if ($ApplicationPath) {
        $resolvedApplication = (Resolve-Path -LiteralPath $ApplicationPath -ErrorAction Stop).Path
        $arguments += $resolvedApplication
    }
    $appProcess = Start-Process `
        -FilePath $resolvedExecutable `
        -ArgumentList $arguments `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    $pageTarget = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($appProcess.HasExited) {
            throw "Packaged application exited before its renderer became available."
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
        throw "Packaged renderer did not expose a page target within 45 seconds."
    }

    $expression = @'
(async () => {
  const findSignInControls = () => ({
    email: document.querySelector('input[placeholder="Enter your email or username"]'),
    password: document.querySelector('input[type="password"]'),
    signIn: Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Sign in'
    )
  });
  let controls = findSignInControls();
  const signInDeadline = Date.now() + 30000;
  while ((!controls.email || !controls.password || !controls.signIn) && Date.now() < signInDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    controls = findSignInControls();
  }
  const root = document.querySelector('#root');
  const bridgeReady = Boolean(
    window.desktop?.setRefreshToken &&
    window.desktop?.getRefreshToken &&
    window.desktop?.clearRefreshToken
  );
  let secureStorageRoundTrip = false;
  let localStorageIsClean = false;
  if (bridgeReady) {
    const stored = await window.desktop.setRefreshToken('packaged.smoke.refresh-token');
    const recovered = await window.desktop.getRefreshToken();
    const cleared = await window.desktop.clearRefreshToken();
    secureStorageRoundTrip = stored && recovered === 'packaged.smoke.refresh-token' && cleared;
    localStorageIsClean = localStorage.getItem('refresh_token') === null;
  }
  const { email, password: passwordInput, signIn } = controls;
  let firebaseLoginRejectedSafely = false;
  if (email && passwordInput && signIn) {
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue(email, `release-validation-${Date.now()}@example.invalid`);
    setValue(passwordInput, 'not-a-real-password');
    signIn.click();
    const loginDeadline = Date.now() + 20000;
    while (Date.now() < loginDeadline) {
      if (document.body?.innerText?.includes('Invalid email or password')) {
        firebaseLoginRejectedSafely = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return {
    readyState: document.readyState,
    rootChildren: root?.childElementCount ?? 0,
    visibleText: document.body?.innerText?.slice(0, 2000) ?? '',
    bridgeReady,
    secureStorageRoundTrip,
    localStorageIsClean,
    firebaseLoginRejectedSafely
  };
})()
'@
    $response = Invoke-CdpCommand -WebSocketUrl $pageTarget.webSocketDebuggerUrl -Message @{
        id = 1
        method = "Runtime.evaluate"
        params = @{
            expression = $expression
            awaitPromise = $true
            returnByValue = $true
        }
    }
    if ($response.result.exceptionDetails) {
        throw "Packaged renderer smoke evaluation raised an exception."
    }
    $result = $response.result.result.value
    if ($result.readyState -ne "complete" -or $result.rootChildren -lt 1) {
        throw "Packaged renderer did not mount the application interface."
    }
    if ($result.visibleText -notmatch "Log in to your account") {
        throw "Packaged renderer did not show the expected authentication interface."
    }
    if (-not $result.bridgeReady -or -not $result.secureStorageRoundTrip -or -not $result.localStorageIsClean) {
        throw "Packaged encrypted-session bridge failed its round-trip validation."
    }
    if (-not $result.firebaseLoginRejectedSafely) {
        throw "Packaged Firebase login did not reach the expected valid-key credential response. Renderer text: $($result.visibleText)"
    }

    $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
    if ($stderr -match "auth/invalid-api-key|auth/api-key-not-valid|Uncaught FirebaseError") {
        throw "Packaged renderer reported an invalid Firebase API key."
    }
    Write-Host "Packaged Electron startup, renderer mount, encrypted-session round trip, and Firebase login validation passed."
    $smokeSucceeded = $true
} catch {
    Write-Warning "Packaged smoke-test logs were retained at $testRoot"
    throw
} finally {
    $env:LOCALAPPDATA = $previousLocalAppData
    if ($appProcess -and -not $appProcess.HasExited) {
        Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='myailibrary-backend.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($localAppData) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if ($smokeSucceeded -and (Test-Path -LiteralPath $testRoot)) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
        if ($resolvedTestRoot.StartsWith($resolvedTemporaryRoot + [IO.Path]::DirectorySeparatorChar)) {
            Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
        }
    }
}
