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

if ([string]::IsNullOrWhiteSpace($ticketmasterKey)) {
    Write-WarnMsg "TICKETMASTER_API_KEY is empty in .env"
}
if ([string]::IsNullOrWhiteSpace($setlistFmKey)) {
    Write-WarnMsg "SETLISTFM_API_KEY is empty in .env"
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
Write-Host "API: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173 (if dev server started)" -ForegroundColor Cyan
