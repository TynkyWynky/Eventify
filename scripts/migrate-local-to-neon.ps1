param(
  [string]$LocalDbUrl = $env:LOCAL_DB_URL,
  [string]$NeonDbUrl = $env:NEON_DB_URL,
  [string]$DumpPath = "",
  [switch]$NoReset,
  [switch]$UseDocker,
  [string]$DockerImage = "postgres:15-alpine"
)

$ErrorActionPreference = "Stop"

function Has-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Run-Checked {
  param(
    [string]$Command,
    [string[]]$Args
  )

  & $Command @Args
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

function Ensure-ConnectionString {
  param(
    [string]$Raw,
    [string]$Name
  )

  $value = ""
  if (-not [string]::IsNullOrWhiteSpace($Raw)) {
    $value = $Raw.Trim()
  }

  if ($value -eq "") {
    throw "$Name is empty. Pass it via parameters or env var."
  }

  return $value
}

function Resolve-FullDumpPath {
  param([string]$InputPath)

  if ([string]::IsNullOrWhiteSpace($InputPath)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $InputPath = Join-Path (Get-Location) "eventify-local-$stamp.dump"
  }

  return [System.IO.Path]::GetFullPath($InputPath)
}

function Convert-DbUrlForDocker {
  param([string]$DbUrl)

  $updated = $DbUrl
  $updated = $updated -replace "@localhost(?=[:/])", "@host.docker.internal"
  $updated = $updated -replace "@127\.0\.0\.1(?=[:/])", "@host.docker.internal"
  return $updated
}

function Invoke-PgDump {
  param(
    [string]$Mode,
    [string]$DbUrl,
    [string]$DbUrlDocker,
    [string]$DumpDir,
    [string]$DumpFile,
    [string]$DockerImage
  )

  if ($Mode -eq "native") {
    Run-Checked -Command "pg_dump" -Args @(
      $DbUrl,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file", (Join-Path $DumpDir $DumpFile)
    )
    return
  }

  Run-Checked -Command "docker" -Args @(
    "run", "--rm",
    "-v", "${DumpDir}:/work",
    $DockerImage,
    "pg_dump", $DbUrlDocker,
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file", "/work/$DumpFile"
  )
}

function Invoke-Psql {
  param(
    [string]$Mode,
    [string]$DbUrl,
    [string]$DbUrlDocker,
    [string]$DockerImage,
    [string[]]$PsqlArgs
  )

  if ($Mode -eq "native") {
    $args = @($DbUrl) + $PsqlArgs
    Run-Checked -Command "psql" -Args $args
    return
  }

  $dockerArgs = @("run", "--rm", $DockerImage, "psql", $DbUrlDocker) + $PsqlArgs
  Run-Checked -Command "docker" -Args $dockerArgs
}

function Invoke-PgRestore {
  param(
    [string]$Mode,
    [string]$DbUrl,
    [string]$DbUrlDocker,
    [string]$DumpDir,
    [string]$DumpFile,
    [string]$DockerImage
  )

  if ($Mode -eq "native") {
    Run-Checked -Command "pg_restore" -Args @(
      "--dbname=$DbUrl",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      (Join-Path $DumpDir $DumpFile)
    )
    return
  }

  Run-Checked -Command "docker" -Args @(
    "run", "--rm",
    "-v", "${DumpDir}:/work",
    $DockerImage,
    "pg_restore",
    "--dbname=$DbUrlDocker",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "/work/$DumpFile"
  )
}

$hasPgDump = Has-Command -Name "pg_dump"
$hasPgRestore = Has-Command -Name "pg_restore"
$hasPsql = Has-Command -Name "psql"
$nativeToolsOk = $hasPgDump -and $hasPgRestore -and $hasPsql
$hasDocker = Has-Command -Name "docker"

$toolMode = "native"
if ($UseDocker) {
  if (-not $hasDocker) {
    throw "UseDocker was requested, but 'docker' is not installed/in PATH."
  }
  $toolMode = "docker"
} elseif (-not $nativeToolsOk) {
  if ($hasDocker) {
    $toolMode = "docker"
    Write-Warning "PostgreSQL CLI tools not found; using Docker fallback."
  } else {
    throw @"
Neither PostgreSQL CLI tools nor Docker are available.
Install one of these options:
1) PostgreSQL client tools (pg_dump, pg_restore, psql), or
2) Docker Desktop and rerun this script with -UseDocker.
"@
  }
}

$local = Ensure-ConnectionString -Raw $LocalDbUrl -Name "LocalDbUrl"
$neon = Ensure-ConnectionString -Raw $NeonDbUrl -Name "NeonDbUrl"

if (-not ($local -match "localhost|127\.0\.0\.1")) {
  Write-Warning "LocalDbUrl does not look local. Continue only if intentional."
}
if ($neon -match "localhost|127\.0\.0\.1") {
  throw "NeonDbUrl points to localhost. Use your Neon managed Postgres URL."
}
if (-not ($neon -match "sslmode=require")) {
  Write-Warning "NeonDbUrl does not include sslmode=require. Neon usually requires it."
}
if ($neon -match "pooler") {
  Write-Warning "NeonDbUrl looks like a pooler URL. Prefer direct Neon URL for restore."
}

$dumpFullPath = Resolve-FullDumpPath -InputPath $DumpPath
$dumpDir = Split-Path -Path $dumpFullPath -Parent
$dumpFile = Split-Path -Path $dumpFullPath -Leaf
$localForDocker = Convert-DbUrlForDocker -DbUrl $local
$neonForDocker = Convert-DbUrlForDocker -DbUrl $neon

Write-Host "== Eventify DB Migration: local -> Neon ==" -ForegroundColor Cyan
Write-Host "Mode   : $toolMode"
Write-Host "Local  : $local"
Write-Host "Neon   : $neon"
Write-Host "Dump   : $dumpFullPath"
Write-Host ""

Write-Host "[1/5] Dumping local database..." -ForegroundColor Yellow
Invoke-PgDump -Mode $toolMode -DbUrl $local -DbUrlDocker $localForDocker -DumpDir $dumpDir -DumpFile $dumpFile -DockerImage $DockerImage

if (-not $NoReset) {
  Write-Host "[2/5] Resetting Neon public schema..." -ForegroundColor Yellow
  Invoke-Psql -Mode $toolMode -DbUrl $neon -DbUrlDocker $neonForDocker -DockerImage $DockerImage -PsqlArgs @(
    "-v", "ON_ERROR_STOP=1",
    "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  )
} else {
  Write-Host "[2/5] Skipping Neon schema reset (-NoReset)." -ForegroundColor Yellow
}

Write-Host "[3/5] Ensuring pgcrypto extension..." -ForegroundColor Yellow
try {
  Invoke-Psql -Mode $toolMode -DbUrl $neon -DbUrlDocker $neonForDocker -DockerImage $DockerImage -PsqlArgs @(
    "-v", "ON_ERROR_STOP=1",
    "-c", "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
  )
} catch {
  Write-Warning "Could not create pgcrypto extension automatically. Continuing..."
}

Write-Host "[4/5] Restoring dump into Neon..." -ForegroundColor Yellow
Invoke-PgRestore -Mode $toolMode -DbUrl $neon -DbUrlDocker $neonForDocker -DumpDir $dumpDir -DumpFile $dumpFile -DockerImage $DockerImage

$verifySql = @"
SELECT 'events' AS table_name, COUNT(*)::bigint AS row_count FROM events
UNION ALL
SELECT 'users', COUNT(*)::bigint FROM users
UNION ALL
SELECT 'event_registrations', COUNT(*)::bigint FROM event_registrations
ORDER BY table_name;
"@

Write-Host "[5/5] Verifying key row counts (local)..." -ForegroundColor Yellow
try {
  Invoke-Psql -Mode $toolMode -DbUrl $local -DbUrlDocker $localForDocker -DockerImage $DockerImage -PsqlArgs @(
    "-v", "ON_ERROR_STOP=1",
    "-P", "pager=off",
    "-c", $verifySql
  )
} catch {
  Write-Warning "Could not run local verification query."
}

Write-Host "Verifying key row counts (Neon)..." -ForegroundColor Yellow
try {
  Invoke-Psql -Mode $toolMode -DbUrl $neon -DbUrlDocker $neonForDocker -DockerImage $DockerImage -PsqlArgs @(
    "-v", "ON_ERROR_STOP=1",
    "-P", "pager=off",
    "-c", $verifySql
  )
} catch {
  Write-Warning "Could not run Neon verification query."
}

Write-Host ""
Write-Host "Migration complete." -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "1) Set DATABASE_URL in Vercel to your Neon URL."
Write-Host "2) Set DATABASE_SSL=require in Vercel."
Write-Host "3) Redeploy and test /api/health."
