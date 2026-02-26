[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipDocker,
    [switch]$NoFrontend,
    [switch]$Detach,
    [int]$DockerWaitSeconds = 120
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "OK: $Message" -ForegroundColor Green
}

function Write-WarnMsg([string]$Message) {
    Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Require-Command([string]$CommandName) {
    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$CommandName' is not available in PATH."
    }
}

function Parse-Version([string]$Value) {
    $clean = ($Value -replace '[^0-9\.].*$', '').Trim()
    if ([string]::IsNullOrWhiteSpace($clean)) {
        return $null
    }
    try {
        return [Version]$clean
    }
    catch {
        return $null
    }
}

function Ensure-EnvFile([string]$TargetPath, [string]$ExamplePath) {
    if (Test-Path $TargetPath) {
        Write-Ok "Using existing $TargetPath"
        return
    }

    if (-not (Test-Path $ExamplePath)) {
        throw "Missing env template: $ExamplePath"
    }

    Copy-Item $ExamplePath $TargetPath -Force
    Write-WarnMsg "Created $TargetPath from template. Review values before production use."
}

function Get-EnvValue([string]$Path, [string]$Key) {
    if (-not (Test-Path $Path)) {
        return ""
    }

    $escapedKey = [regex]::Escape($Key)
    $line = Select-String -Path $Path -Pattern "^\s*$escapedKey\s*=\s*(.*)\s*$" |
        Select-Object -First 1

    if (-not $line) {
        return ""
    }

    return $line.Matches[0].Groups[1].Value.Trim()
}

function Set-EnvValue([string]$Path, [string]$Key, [string]$Value) {
    if (-not (Test-Path $Path)) {
        throw "Cannot set '$Key' in missing file: $Path"
    }

    $pattern = "^\s*$([regex]::Escape($Key))\s*="
    $lines = @(Get-Content $Path)
    $updated = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $lines[$i] = "$Key=$Value"
            $updated = $true
            break
        }
    }

    if (-not $updated) {
        $lines += "$Key=$Value"
    }

    Set-Content -Path $Path -Value $lines -Encoding utf8
}

function Get-ListeningProcessIdsByPort([int]$Port) {
    try {
        $rows = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        return @($rows | Select-Object -ExpandProperty OwningProcess -Unique)
    }
    catch {
        return @()
    }
}

function Get-ProcessSummary([int[]]$ProcessIds) {
    $items = @()
    foreach ($processId in ($ProcessIds | Sort-Object -Unique)) {
        try {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction Stop
            if ($proc) {
                $name = if ([string]::IsNullOrWhiteSpace($proc.Name)) { "unknown" } else { $proc.Name }
                $cmd = if ([string]::IsNullOrWhiteSpace($proc.CommandLine)) { "" } else { $proc.CommandLine.Trim() }
                if ($cmd.Length -gt 120) {
                    $cmd = $cmd.Substring(0, 120) + "..."
                }
                if ($cmd) {
                    $items += "PID $processId ($name): $cmd"
                }
                else {
                    $items += "PID $processId ($name)"
                }
            }
            else {
                $items += "PID $processId"
            }
        }
        catch {
            $items += "PID $processId"
        }
    }
    return $items -join "; "
}

function Get-AvailableHostPort([int]$PreferredPort, [int]$MaxSearch = 30) {
    $start = [Math]::Max(1, $PreferredPort)
    $end = [Math]::Min(65535, $start + $MaxSearch - 1)

    for ($port = $start; $port -le $end; $port++) {
        $owners = Get-ListeningProcessIdsByPort -Port $port
        if ($owners.Count -eq 0) {
            return $port
        }
    }

    throw "Could not find an available host port between $start and $end."
}

function Get-ComposeApiPublishedPort([string]$ComposeDir) {
    Push-Location $ComposeDir
    try {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $output = & docker compose port api 3000 2>$null
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previous
        }

        if ($exitCode -ne 0 -or [string]::IsNullOrWhiteSpace($output)) {
            return $null
        }

        $line = (@($output) | Select-Object -First 1).ToString().Trim()
        if ($line -match ':(\d+)\s*$') {
            return [int]$Matches[1]
        }

        return $null
    }
    finally {
        Pop-Location
    }
}

function Test-DockerEngineReady {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker info 1>$null 2>$null
        return ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Start-DockerDesktopIfPossible {
    $candidates = @(
        "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$Env:ProgramFiles(x86)\Docker\Docker\Docker Desktop.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -eq 0) {
        Write-WarnMsg "Docker Desktop executable not found automatically. Start Docker Desktop manually."
        return
    }

    Start-Process -FilePath $candidates[0] | Out-Null
    Write-WarnMsg "Starting Docker Desktop..."
}

function Wait-ForDockerEngine([int]$TimeoutSec) {
    $started = $false
    if (-not (Test-DockerEngineReady)) {
        Start-DockerDesktopIfPossible
        $started = $true
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerEngineReady) {
            if ($started) {
                Write-Ok "Docker engine is ready."
            }
            return
        }
        Start-Sleep -Seconds 3
    }

    throw "Docker engine is not reachable after $TimeoutSec seconds. Open Docker Desktop and retry."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $scriptDir "eventify-web"
$backendEnvPath = Join-Path $scriptDir ".env"
$backendEnvExamplePath = Join-Path $scriptDir ".env.example"
$frontendEnvPath = Join-Path $frontendDir ".env"
$frontendEnvExamplePath = Join-Path $frontendDir ".env.example"

Write-Step "Checking required tools"
Require-Command docker
Require-Command node
Require-Command npm
Write-Ok "docker/node/npm found"

$nodeVersionText = (& node -v).Trim().TrimStart("v")
$nodeVersion = Parse-Version $nodeVersionText
$viteMinNode = [Version]"20.19.0"
if ($nodeVersion -and $nodeVersion -lt $viteMinNode) {
    Write-WarnMsg "Node $nodeVersionText detected. Vite 7 expects >= 20.19.0 (or >= 22.12.0). Upgrade Node if frontend build/dev fails."
}

Write-Step "Preparing environment files"
Ensure-EnvFile -TargetPath $backendEnvPath -ExamplePath $backendEnvExamplePath
Ensure-EnvFile -TargetPath $frontendEnvPath -ExamplePath $frontendEnvExamplePath

$ticketmasterKey = Get-EnvValue -Path $backendEnvPath -Key "TICKETMASTER_API_KEY"
$setlistFmKey = Get-EnvValue -Path $backendEnvPath -Key "SETLISTFM_API_KEY"
$scrapeEnabled = Get-EnvValue -Path $backendEnvPath -Key "SCRAPE_ENABLED"
$scrapeSources = Get-EnvValue -Path $backendEnvPath -Key "SCRAPE_SOURCE_URLS"

if ([string]::IsNullOrWhiteSpace($ticketmasterKey)) {
    Write-WarnMsg "TICKETMASTER_API_KEY is empty in .env"
}
if ([string]::IsNullOrWhiteSpace($setlistFmKey)) {
    Write-WarnMsg "SETLISTFM_API_KEY is empty in .env"
}

$scrapeEnabledNormalized = if ([string]::IsNullOrWhiteSpace($scrapeEnabled)) { "true" } else { $scrapeEnabled.Trim().ToLowerInvariant() }
$isScrapeEnabled = -not [string]::IsNullOrWhiteSpace($scrapeEnabledNormalized) -and @("1","true","yes","on") -contains $scrapeEnabledNormalized
if ($isScrapeEnabled -and [string]::IsNullOrWhiteSpace($scrapeSources)) {
    Write-WarnMsg "SCRAPE_ENABLED is true but SCRAPE_SOURCE_URLS is empty. /events will likely show only Ticketmaster events. Example: https://www.eventbrite.com/d/belgium--brussels/music--events/"
}

$preferredApiHostPort = 3000
$configuredApiHostPort = Get-EnvValue -Path $backendEnvPath -Key "API_HOST_PORT"
if (-not [string]::IsNullOrWhiteSpace($configuredApiHostPort)) {
    $parsedApiHostPort = 0
    if ([int]::TryParse($configuredApiHostPort, [ref]$parsedApiHostPort) -and $parsedApiHostPort -ge 1 -and $parsedApiHostPort -le 65535) {
        $preferredApiHostPort = $parsedApiHostPort
    }
    else {
        Write-WarnMsg "Ignoring invalid API_HOST_PORT='$configuredApiHostPort' in .env (expected 1-65535)."
    }
}

$apiHostPort = $preferredApiHostPort
$apiBaseUrl = "http://localhost:$apiHostPort"

if (-not $SkipDocker) {
    $currentComposePort = Get-ComposeApiPublishedPort -ComposeDir $scriptDir
    $preferredOwners = Get-ListeningProcessIdsByPort -Port $preferredApiHostPort
    if ($preferredOwners.Count -gt 0 -and $currentComposePort -eq $preferredApiHostPort) {
        $apiHostPort = $preferredApiHostPort
        Write-Ok "Reusing API host port $apiHostPort from the current Docker Compose stack."
    }
    else {
        $apiHostPort = Get-AvailableHostPort -PreferredPort $preferredApiHostPort
        if ($apiHostPort -ne $preferredApiHostPort) {
            $busySummary = Get-ProcessSummary -ProcessIds $preferredOwners
            if ([string]::IsNullOrWhiteSpace($busySummary)) {
                Write-WarnMsg "Port $preferredApiHostPort is busy. Using API host port $apiHostPort instead."
            }
            else {
                Write-WarnMsg "Port $preferredApiHostPort is busy ($busySummary). Using API host port $apiHostPort instead."
            }
        }
        else {
            Write-Ok "API host port $apiHostPort is available."
        }
    }
    $apiBaseUrl = "http://localhost:$apiHostPort"

    $env:API_HOST_PORT = "$apiHostPort"
    Set-EnvValue -Path $backendEnvPath -Key "API_HOST_PORT" -Value "$apiHostPort"

    $backendApiBaseCurrent = Get-EnvValue -Path $backendEnvPath -Key "API_BASE_URL"
    $backendLooksLocal = [string]::IsNullOrWhiteSpace($backendApiBaseCurrent) -or
        ($backendApiBaseCurrent -match '^https?://(localhost|127\.0\.0\.1)(:\d+)?/?$')
    if ($backendLooksLocal -and $backendApiBaseCurrent -ne $apiBaseUrl) {
        Set-EnvValue -Path $backendEnvPath -Key "API_BASE_URL" -Value $apiBaseUrl
        Write-Ok "Set API_BASE_URL to $apiBaseUrl"
    }

    $frontendApiBaseCurrent = Get-EnvValue -Path $frontendEnvPath -Key "VITE_API_BASE_URL"
    $frontendLooksLocal = [string]::IsNullOrWhiteSpace($frontendApiBaseCurrent) -or
        ($frontendApiBaseCurrent -match '^https?://(localhost|127\.0\.0\.1)(:\d+)?/?$')
    if ($frontendLooksLocal) {
        if ($frontendApiBaseCurrent -ne $apiBaseUrl) {
            Set-EnvValue -Path $frontendEnvPath -Key "VITE_API_BASE_URL" -Value $apiBaseUrl
            Write-Ok "Set VITE_API_BASE_URL to $apiBaseUrl"
        }
    }
    else {
        Write-WarnMsg "VITE_API_BASE_URL is custom ($frontendApiBaseCurrent). Leaving it unchanged."
    }
}

if (-not $SkipInstall) {
    Write-Step "Installing backend dependencies"
    npm install --prefix $scriptDir
    Write-Ok "Backend dependencies installed"

    Write-Step "Installing frontend dependencies"
    npm install --prefix $frontendDir
    Write-Ok "Frontend dependencies installed"
}
else {
    Write-WarnMsg "Skipping dependency installation"
}

if (-not $SkipDocker) {
    Write-Step "Ensuring Docker engine is running"
    Wait-ForDockerEngine -TimeoutSec $DockerWaitSeconds

    Write-Step "Starting backend stack with Docker Compose"
    $composeArgs = @("compose", "up", "--build")
    if ($Detach) {
        $composeArgs += "-d"
    }

    Push-Location $scriptDir
    try {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & docker @composeArgs
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previous
        }
        if ($exitCode -ne 0) {
            throw "docker compose failed with exit code $exitCode"
        }
    }
    finally {
        Pop-Location
    }
}
else {
    Write-WarnMsg "Skipping Docker Compose startup"
}

if (-not $NoFrontend) {
    Write-Step "Starting frontend dev server in a new PowerShell window"
    $escapedFrontendDir = $frontendDir.Replace("'", "''")
    $frontendCommand = "Set-Location '$escapedFrontendDir'; npm run dev"
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy", "Bypass",
        "-Command", $frontendCommand
    ) | Out-Null
    Write-Ok "Frontend dev server launching (default: http://localhost:5173)"
}
else {
    Write-WarnMsg "Frontend dev server start disabled"
}

Write-Host "`nSetup complete." -ForegroundColor Cyan
Write-Host "API: $apiBaseUrl" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173 (if dev server started)" -ForegroundColor Cyan
