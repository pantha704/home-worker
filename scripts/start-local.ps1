$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "Homeworker execution context"
Write-Host "Purpose: faithful, reviewable document-to-different-handwriting A4 conversion."
Write-Host "Gate: no silent mutations; provenance and uncertainty must remain visible."

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop with Compose v2 is required. See docs/deployment.md for native setup."
}

docker compose --env-file infra/.env.example -f infra/compose.yaml up --build

