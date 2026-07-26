param(
    [switch]$IncludeRendererPort
)

$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$ports = @(8000)
if ($IncludeRendererPort) {
    $ports += 5173
}

function Get-ListeningPidsOnPort {
    param([int]$Port)

    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        $matches = netstat -ano -p tcp | Select-String -Pattern ":$Port\s+.*LISTENING"
        $pids = @()
        foreach ($match in $matches) {
            $columns = ($match.Line.Trim() -split "\s+")
            if ($columns.Length -ge 5) {
                $pidValue = 0
                if ([int]::TryParse($columns[4], [ref]$pidValue)) {
                    $pids += $pidValue
                }
            }
        }
        return @($pids | Select-Object -Unique)
    }
}

function Get-ProcessCommandLineSafe {
    param([int]$ProcessId)

    try {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        return [string]$processInfo.CommandLine
    } catch {
        return ""
    }
}

function Test-IsMyAiRuntimeProcess {
    param(
        [int]$ProcessId,
        [int]$Port
    )

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
    } catch {
        return $false
    }

    $commandLine = Get-ProcessCommandLineSafe -ProcessId $ProcessId
    $repoRootText = [string]$repoRoot

    if ($commandLine -and $commandLine.Contains($repoRootText)) {
        return $true
    }

    if ($commandLine -and $commandLine.Contains("desktop_entry.py")) {
        return $true
    }

    if ($process.ProcessName -eq "myailibrary-backend") {
        return $true
    }

    # In development, 8000 is reserved for the local FastAPI backend and 5173
    # is reserved for this project's Vite renderer. If command-line lookup is
    # blocked by Windows, this fallback still cleans the known dev ports.
    if (($Port -eq 8000 -and $process.ProcessName -match "^(python|pythonw)$") -or
        ($Port -eq 5173 -and $process.ProcessName -match "^(node|npm|cmd)$")) {
        return $true
    }

    return $false
}

foreach ($port in $ports) {
    $pids = Get-ListeningPidsOnPort -Port $port
    foreach ($pidValue in $pids) {
        if (-not $pidValue -or $pidValue -eq $PID) {
            continue
        }

        if (Test-IsMyAiRuntimeProcess -ProcessId $pidValue -Port $port) {
            Write-Host "[runtime-cleanup] stopping stale MyAiLibrary process $pidValue on port $port"
            try {
                Stop-Process -Id $pidValue -Force -ErrorAction Stop
            } catch {
                Write-Warning "[runtime-cleanup] could not stop process $pidValue on port ${port}: $($_.Exception.Message)"
            }
        } else {
            Write-Host "[runtime-cleanup] port $port is busy, but PID $pidValue does not look like MyAiLibrary; leaving it alone"
        }
    }
}
