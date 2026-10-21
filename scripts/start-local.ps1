$ErrorActionPreference = 'Stop'

try {
    $root = Split-Path $PSScriptRoot -Parent
    Set-Location -LiteralPath $root
    $stateDir = Join-Path $root '.local-run'
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

    $node = Join-Path $root '.runtime\node\node.exe'
    if (-not (Test-Path -LiteralPath $node)) {
        $installed = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $installed) {
            throw 'Node.js not found. Include .runtime\node in the archive or install Node.js 24.'
        }
        $node = $installed.Source
    }
    $version = & $node --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') {
        throw "Node.js 24 is required; found: $version"
    }
    Write-Host "Node.js: $version"
    $env:Path = (Split-Path $node -Parent) + ';' + $env:Path

    $vite = Join-Path $root 'scripts\serve-local.mjs'
    if (-not (Test-Path -LiteralPath (Join-Path $root 'src\dist\index.html'))) {
        throw 'The ready-to-run build is missing. Extract the complete portable archive.'
    }

    $port = 8080
    $url = "http://127.0.0.1:$port/"
    $pidFile = Join-Path $stateDir 'server.pid'
    $server = $null
    if (Test-Path -LiteralPath $pidFile) {
        $serverId = (Get-Content -LiteralPath $pidFile -Raw).Trim()
        if ($serverId -match '^\d+$') {
            $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $serverId" -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.CommandLine.Contains($vite)) {
                if ((Get-Item -LiteralPath $vite).LastWriteTime -gt $candidate.CreationDate) {
                    Stop-Process -Id $candidate.ProcessId
                } else {
                    $server = $candidate
                }
            }
        }
    }
    if (-not $server) {
        $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($listener) { throw "Port $port is already in use. Stop the previous local server and try again." }
        Write-Host 'Starting local Betaflight Configurator...'
        $server = Start-Process -FilePath $node -ArgumentList @("`"$vite`"") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'server.log') -RedirectStandardError (Join-Path $stateDir 'server-error.log') -PassThru
        Set-Content -LiteralPath $pidFile -Value $server.Id -Encoding ASCII
    }

    $ready = $false
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) { throw "Server did not become ready. See $stateDir\server-error.log" }

    $browser = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    Write-Host "Opening $url"
    $profileName = 'chrome-profile'
    if (-not $browser) {
        $browser = @(
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
            "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
        ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        $profileName = 'edge-profile'
    }
    if (-not $browser) { throw 'Microsoft Edge or Google Chrome is required. Install either browser and try again.' }
    $profile = Join-Path $stateDir $profileName
    $browserName = [System.IO.Path]::GetFileName($browser)
    $existing = Get-CimInstance Win32_Process -Filter "Name = '$browserName'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) }
    foreach ($process in $existing) {
        $window = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
        if ($window -and $window.MainWindowHandle -ne 0) {
            $shell = New-Object -ComObject WScript.Shell
            if ($shell.AppActivate([int]$process.ProcessId)) {
                Write-Host 'The existing configurator window is already open.'
                exit 0
            }
        }
    }
    $edgeArgs = @(
        "--user-data-dir=`"$profile`"",
        "--app=$url",
        '--start-maximized',
        '--no-first-run',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
    )
    Start-Process -FilePath $browser -ArgumentList $edgeArgs
    Write-Host 'Ready. Closing the browser tab does not stop the local server.'
    exit 0
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
