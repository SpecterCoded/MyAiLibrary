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

    if (
        -not $commandLine -or
        $commandLine.IndexOf($repoRootText, [System.StringComparison]::OrdinalIgnoreCase) -lt 0
    ) {
        return $false
    }

    if ($Port -eq 8000) {
        return $commandLine.IndexOf("desktop_entry.py", [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    }

    if ($Port -eq 5173) {
        return $commandLine.IndexOf("vite", [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    }

    return $false
}

function Stop-ProcessTreeSafe {
    param([int]$ProcessId)

    try {
        $killer = Start-Process -FilePath "taskkill.exe" `
            -ArgumentList @("/PID", [string]$ProcessId, "/T", "/F") `
            -WindowStyle Hidden `
            -Wait `
            -PassThru `
            -ErrorAction Stop
        if ($killer.ExitCode -ne 0) {
            throw "taskkill exited with code $($killer.ExitCode)"
        }
    } catch {
        throw $_
    }
}

function Stop-StaleElectronDevTrees {
    $repoRootText = [string]$repoRoot
    try {
        $electronProcesses = @(
            Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction Stop |
                Where-Object {
                    $commandLine = [string]$_.CommandLine
                    $commandLine -and
                    $commandLine.IndexOf($repoRootText, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                    $commandLine.IndexOf("--type=", [System.StringComparison]::OrdinalIgnoreCase) -lt 0
                }
        )
    } catch {
        Write-Warning "[runtime-cleanup] could not inspect stale Electron processes: $($_.Exception.Message)"
        return
    }

    foreach ($electronProcess in $electronProcesses) {
        $processId = [int]$electronProcess.ProcessId
        if (-not $processId -or $processId -eq $PID) {
            continue
        }
        Write-Host "[runtime-cleanup] stopping stale MyAiLibrary Electron tree $processId"
        try {
            Stop-ProcessTreeSafe -ProcessId $processId
        } catch {
            Write-Warning "[runtime-cleanup] could not stop Electron process ${processId}: $($_.Exception.Message)"
        }
    }
}

Stop-StaleElectronDevTrees

foreach ($port in $ports) {
    $pids = Get-ListeningPidsOnPort -Port $port
    foreach ($pidValue in $pids) {
        if (-not $pidValue -or $pidValue -eq $PID) {
            continue
        }

        if (Test-IsMyAiRuntimeProcess -ProcessId $pidValue -Port $port) {
            Write-Host "[runtime-cleanup] stopping stale MyAiLibrary process tree $pidValue on port $port"
            try {
                Stop-ProcessTreeSafe -ProcessId $pidValue
            } catch {
                Write-Warning "[runtime-cleanup] could not stop process $pidValue on port ${port}: $($_.Exception.Message)"
            }
        } else {
            Write-Host "[runtime-cleanup] port $port is busy, but PID $pidValue does not look like MyAiLibrary; leaving it alone"
        }
    }
}
