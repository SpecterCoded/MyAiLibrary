param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [int]$RemoteDebuggingPort = 9323,

    [string]$ApplicationPath = "",

    [string]$FirebaseApiKey = $env:VITE_FIREBASE_API_KEY
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$testRoot = Join-Path $temporaryRoot ("myailibrary-packaged-smoke-" + [guid]::NewGuid().ToString("N"))
$chromiumData = Join-Path $testRoot "chromium"
$localAppData = Join-Path $testRoot "local-app-data"
$stdoutPath = Join-Path $testRoot "stdout.log"
$stderrPath = Join-Path $testRoot "stderr.log"
$defaultWorkspacePath = Join-Path $testRoot "app-created-default-workspace"
$workspacePath = Join-Path $testRoot "selected-existing-workspace"
$workspaceSentinelPath = Join-Path $workspacePath "preserve-me.txt"
New-Item -ItemType Directory -Path $chromiumData, $localAppData, $workspacePath | Out-Null
Set-Content -LiteralPath $workspaceSentinelPath -Value "workspace sentinel" -Encoding utf8

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
$firebaseCleanupFailed = $false
$firebaseIdToken = $null
$firebaseEmail = "release-validation-$([guid]::NewGuid().ToString('N'))@example.com"
$firebasePassword = "Release-$([guid]::NewGuid().ToString('N'))!A9"
$firebaseUsername = "ReleaseValidation$([guid]::NewGuid().ToString('N').Substring(0, 12))"
try {
    if ([string]::IsNullOrWhiteSpace($FirebaseApiKey)) {
        throw "Packaged authentication smoke test requires the Firebase web API key."
    }
    try {
        $signupUri = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$FirebaseApiKey"
        $firebaseSignup = Invoke-RestMethod `
            -Method Post `
            -Uri $signupUri `
            -ContentType "application/json" `
            -Body (@{
                email = $firebaseEmail
                password = $firebasePassword
                returnSecureToken = $true
            } | ConvertTo-Json -Compress) `
            -TimeoutSec 30
        $firebaseIdToken = $firebaseSignup.idToken
        if ([string]::IsNullOrWhiteSpace($firebaseIdToken)) {
            throw "Firebase did not return an ID token."
        }
    } catch {
        throw "Unable to create the ephemeral Firebase packaged-auth validation account."
    }

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

    $firebaseTokenJson = $firebaseIdToken | ConvertTo-Json -Compress
    $firebaseEmailJson = $firebaseEmail | ConvertTo-Json -Compress
    $firebaseUsernameJson = $firebaseUsername | ConvertTo-Json -Compress
    $defaultWorkspacePathJson = $defaultWorkspacePath | ConvertTo-Json -Compress
    $workspacePathJson = $workspacePath | ConvertTo-Json -Compress
    $expression = @'
(async () => {
  const firebaseToken = __FIREBASE_TOKEN__;
  const expectedEmail = __FIREBASE_EMAIL__;
  const expectedUsername = __FIREBASE_USERNAME__;
  const defaultWorkspaceRoot = __DEFAULT_WORKSPACE_PATH__;
  const workspaceRoot = __WORKSPACE_PATH__;
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
  let packagedAuthRoundTrip = false;
  let usernameResolutionRoundTrip = false;
  let secureStorageRoundTrip = false;
  let workspaceStorageRoundTrip = false;
  let localStorageIsClean = false;
  const authStatuses = {};
  try {
    const completionResponse = await fetch('/auth/complete-signup', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${firebaseToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: expectedUsername,
        avatar_url: ''
      })
    });
    authStatuses.completeSignup = completionResponse.status;
    const completion = await completionResponse.json().catch(() => ({}));

    const exactResolutionResponse = await fetch(
      `/auth/resolve-email?username_or_email=${encodeURIComponent(expectedUsername)}`
    );
    authStatuses.resolveExact = exactResolutionResponse.status;
    const exactResolution = await exactResolutionResponse.json().catch(() => ({}));

    const mixedResolutionResponse = await fetch(
      `/auth/resolve-email?username_or_email=${encodeURIComponent(expectedUsername.toUpperCase())}`
    );
    authStatuses.resolveMixedCase = mixedResolutionResponse.status;
    const mixedResolution = await mixedResolutionResponse.json().catch(() => ({}));

    const sessionResponse = await fetch('/auth/firebase-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firebase_token: firebaseToken,
        remember_me: true
      })
    });
    authStatuses.firebaseSession = sessionResponse.status;
    const sessionData = await sessionResponse.json().catch(() => ({}));

    let profile = {};
    if (sessionResponse.ok && sessionData.access_token) {
      const profileResponse = await fetch('/me', {
        headers: { Authorization: `Bearer ${sessionData.access_token}` }
      });
      authStatuses.profile = profileResponse.status;
      profile = await profileResponse.json().catch(() => ({}));

      const workspaceHeaders = { Authorization: `Bearer ${sessionData.access_token}` };
      const createDefaultWorkspaceResponse = await fetch(
        `/storage-paths/default?name=${encodeURIComponent('Packaged default')}&path=${encodeURIComponent(defaultWorkspaceRoot)}`,
        { method: 'POST', headers: workspaceHeaders }
      );
      authStatuses.createDefaultWorkspace = createDefaultWorkspaceResponse.status;
      const createdDefaultWorkspace = await createDefaultWorkspaceResponse.json().catch(() => ({}));

      const createWorkspaceResponse = await fetch(
        `/storage-paths?name=${encodeURIComponent('Packaged workspace')}&path=${encodeURIComponent(workspaceRoot)}`,
        { method: 'POST', headers: workspaceHeaders }
      );
      authStatuses.createWorkspace = createWorkspaceResponse.status;
      const createdWorkspace = await createWorkspaceResponse.json().catch(() => ({}));

      const listWorkspaceResponse = await fetch('/storage-paths', {
        headers: workspaceHeaders
      });
      authStatuses.listWorkspaces = listWorkspaceResponse.status;
      const workspaces = await listWorkspaceResponse.json().catch(() => []);

      const activateWorkspaceResponse = createdWorkspace.id
        ? await fetch(
            `/me/active-storage-path?path_id=${encodeURIComponent(createdWorkspace.id)}`,
            { method: 'PATCH', headers: workspaceHeaders }
          )
        : { ok: false, status: 0 };
      authStatuses.activateWorkspace = activateWorkspaceResponse.status;

      const activeProfileResponse = await fetch('/me', {
        headers: workspaceHeaders
      });
      authStatuses.activeWorkspaceProfile = activeProfileResponse.status;
      const activeProfile = await activeProfileResponse.json().catch(() => ({}));

      const deleteDefaultResponse = createdDefaultWorkspace.id
        ? await fetch(
            `/storage-paths/${encodeURIComponent(createdDefaultWorkspace.id)}?confirm=true`,
            { method: 'DELETE', headers: workspaceHeaders }
          )
        : { ok: false, status: 0 };
      authStatuses.deleteDefaultWorkspace = deleteDefaultResponse.status;

      const deleteWorkspaceResponse = createdWorkspace.id
        ? await fetch(
            `/storage-paths/${encodeURIComponent(createdWorkspace.id)}?confirm=true`,
            { method: 'DELETE', headers: workspaceHeaders }
          )
        : { ok: false, status: 0 };
      authStatuses.deleteWorkspace = deleteWorkspaceResponse.status;
      const deletedWorkspace = deleteWorkspaceResponse.json
        ? await deleteWorkspaceResponse.json().catch(() => ({}))
        : {};

      const listAfterDeleteResponse = await fetch('/storage-paths', {
        headers: workspaceHeaders
      });
      authStatuses.listAfterDelete = listAfterDeleteResponse.status;
      const workspacesAfterDelete = await listAfterDeleteResponse.json().catch(() => []);

      const profileAfterDeleteResponse = await fetch('/me', {
        headers: workspaceHeaders
      });
      authStatuses.profileAfterDelete = profileAfterDeleteResponse.status;
      const profileAfterDelete = await profileAfterDeleteResponse.json().catch(() => ({}));
      const normalizePath = (value) => String(value || '').replaceAll('/', '\\').toLowerCase();
      workspaceStorageRoundTrip = Boolean(
        createDefaultWorkspaceResponse.ok &&
        createdDefaultWorkspace.is_default === true &&
        createWorkspaceResponse.ok &&
        createdWorkspace.is_default === false &&
        listWorkspaceResponse.ok &&
        Array.isArray(workspaces) &&
        workspaces.some((workspace) => workspace.id === createdDefaultWorkspace.id && workspace.is_default === true) &&
        workspaces.some((workspace) => workspace.id === createdWorkspace.id) &&
        activateWorkspaceResponse.ok &&
        activeProfileResponse.ok &&
        normalizePath(createdWorkspace.path) === normalizePath(workspaceRoot) &&
        normalizePath(activeProfile.storage_root) === normalizePath(workspaceRoot) &&
        deleteDefaultResponse.status === 403 &&
        deleteWorkspaceResponse.ok &&
        deletedWorkspace.switched_to_default === true &&
        normalizePath(deletedWorkspace.active_path) === normalizePath(defaultWorkspaceRoot) &&
        listAfterDeleteResponse.ok &&
        Array.isArray(workspacesAfterDelete) &&
        workspacesAfterDelete.some((workspace) => workspace.id === createdDefaultWorkspace.id) &&
        !workspacesAfterDelete.some((workspace) => workspace.id === createdWorkspace.id) &&
        profileAfterDeleteResponse.ok &&
        normalizePath(profileAfterDelete.storage_root) === normalizePath(defaultWorkspaceRoot)
      );
    }

    usernameResolutionRoundTrip = Boolean(
      exactResolutionResponse.ok &&
      mixedResolutionResponse.ok &&
      exactResolution.email?.toLowerCase() === expectedEmail.toLowerCase() &&
      mixedResolution.email?.toLowerCase() === expectedEmail.toLowerCase()
    );
    packagedAuthRoundTrip = Boolean(
      completionResponse.ok &&
      completion.username === expectedUsername &&
      sessionResponse.ok &&
      sessionData.user?.username === expectedUsername &&
      profile.username === expectedUsername &&
      profile.email?.toLowerCase() === expectedEmail.toLowerCase()
    );

    if (bridgeReady && sessionData.refresh_token) {
      const stored = await window.desktop.setRefreshToken(sessionData.refresh_token);
      const recovered = await window.desktop.getRefreshToken();
      const cleared = await window.desktop.clearRefreshToken();
      secureStorageRoundTrip = Boolean(
        stored &&
        recovered === sessionData.refresh_token &&
        cleared
      );
      localStorageIsClean = localStorage.getItem('refresh_token') === null;
    }
  } catch {
    // Status flags are returned to PowerShell without exposing credentials.
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
    packagedAuthRoundTrip,
    usernameResolutionRoundTrip,
    secureStorageRoundTrip,
    workspaceStorageRoundTrip,
    localStorageIsClean,
    firebaseLoginRejectedSafely,
    authStatuses
  };
})()
'@
    $expression = $expression.Replace("__FIREBASE_TOKEN__", $firebaseTokenJson)
    $expression = $expression.Replace("__FIREBASE_EMAIL__", $firebaseEmailJson)
    $expression = $expression.Replace("__FIREBASE_USERNAME__", $firebaseUsernameJson)
    $expression = $expression.Replace("__DEFAULT_WORKSPACE_PATH__", $defaultWorkspacePathJson)
    $expression = $expression.Replace("__WORKSPACE_PATH__", $workspacePathJson)
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
    if (-not $result.packagedAuthRoundTrip -or -not $result.usernameResolutionRoundTrip) {
        $statusSummary = $result.authStatuses | ConvertTo-Json -Compress
        throw "Packaged Firebase signup, session, profile, or username resolution failed. HTTP statuses: $statusSummary"
    }
    if (-not $result.bridgeReady -or -not $result.secureStorageRoundTrip -or -not $result.localStorageIsClean) {
        throw "Packaged encrypted-session bridge failed its round-trip validation."
    }
    if (-not $result.workspaceStorageRoundTrip) {
        $statusSummary = $result.authStatuses | ConvertTo-Json -Compress
        throw "Packaged workspace registration, listing, activation, protection, or deletion failed. HTTP statuses: $statusSummary"
    }
    if ((Get-Content -LiteralPath $workspaceSentinelPath -Raw).Trim() -ne "workspace sentinel") {
        throw "Packaged workspace registration or deletion modified an unrelated file."
    }
    if (-not $result.firebaseLoginRejectedSafely) {
        throw "Packaged Firebase login did not reach the expected valid-key credential response. Renderer text: $($result.visibleText)"
    }

    $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
    if ($stderr -match "auth/invalid-api-key|auth/api-key-not-valid|Uncaught FirebaseError") {
        throw "Packaged renderer reported an invalid Firebase API key."
    }
    Write-Host "Packaged Electron startup, authentication, workspace lifecycle, renderer mount, and encrypted-session round trip passed."
    $smokeSucceeded = $true
} catch {
    Write-Warning "Packaged smoke-test logs were retained at $testRoot"
    throw
} finally {
    $env:LOCALAPPDATA = $previousLocalAppData
    if ($firebaseIdToken) {
        try {
            $deleteUri = "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=$FirebaseApiKey"
            Invoke-RestMethod `
                -Method Post `
                -Uri $deleteUri `
                -ContentType "application/json" `
                -Body (@{ idToken = $firebaseIdToken } | ConvertTo-Json -Compress) `
                -TimeoutSec 30 | Out-Null
        } catch {
            $firebaseCleanupFailed = $true
            Write-Warning "The ephemeral Firebase packaged-auth validation account could not be deleted automatically."
        }
    }
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
    if ($firebaseCleanupFailed) {
        throw "The packaged-auth validation account cleanup failed."
    }
}
