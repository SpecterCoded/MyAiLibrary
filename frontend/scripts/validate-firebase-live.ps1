$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

$apiKey = [string]$env:VITE_FIREBASE_API_KEY
if ($apiKey -notmatch '^AIza[A-Za-z0-9_-]{35}$') {
    throw "A valid unquoted Firebase web API key is required for live validation."
}

$uri = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$([Uri]::EscapeDataString($apiKey))"
$body = @{
    email = "release-validation-$([guid]::NewGuid().ToString('N'))@example.invalid"
    password = "not-a-real-password"
    returnSecureToken = $true
} | ConvertTo-Json

$client = [Net.Http.HttpClient]::new()
try {
    $client.Timeout = [TimeSpan]::FromSeconds(15)
    $content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, "application/json")
    try {
        $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
        $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    } finally {
        $content.Dispose()
    }

    if ($response.IsSuccessStatusCode) {
        throw "Firebase unexpectedly authenticated the validation account."
    }

    $payload = $responseBody | ConvertFrom-Json -ErrorAction SilentlyContinue
    $firebaseError = [string]$payload.error.message
    $acceptedResponses = @(
        "INVALID_LOGIN_CREDENTIALS",
        "EMAIL_NOT_FOUND",
        "INVALID_PASSWORD",
        "USER_DISABLED",
        "OPERATION_NOT_ALLOWED"
    )
    if ($firebaseError -notin $acceptedResponses) {
        $contentType = [string]$response.Content.Headers.ContentType
        throw "Firebase rejected the release authentication configuration (HTTP $([int]$response.StatusCode), $contentType, $firebaseError)."
    }
    Write-Host "Firebase accepted the release authentication configuration ($firebaseError)."
} finally {
    $client.Dispose()
}
