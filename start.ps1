# ABBYY Rechnungsvorfilterung - Starter
# Doppelklick auf diese Datei um die App zu starten
# Kein Admin, keine Installation nötig

$ErrorActionPreference = "Stop"
$NODE_VERSION = "18.20.4"
$NODE_DIR = "$env:USERPROFILE\rechnungen-nodejs"
$NODE_EXE = "$NODE_DIR\node.exe"
$NPM_CMD  = "$NODE_DIR\npm.cmd"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Althoff Hotels - Rechnungsvorfilterung" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Node.js prüfen / herunterladen ──────────────────────────────────────
if (-not (Test-Path $NODE_EXE)) {
    Write-Host "[1/4] Node.js wird heruntergeladen (einmalig, ~30 MB)..." -ForegroundColor Yellow

    $ZIP_URL  = "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip"
    $ZIP_FILE = "$env:TEMP\nodejs-portable.zip"

    try {
        Invoke-WebRequest -Uri $ZIP_URL -OutFile $ZIP_FILE -UseBasicParsing
    } catch {
        Write-Host ""
        Write-Host "FEHLER: Download fehlgeschlagen." -ForegroundColor Red
        Write-Host "Bitte prüfen Sie die Internetverbindung und versuchen Sie es erneut." -ForegroundColor Red
        Read-Host "Drücken Sie Enter zum Beenden"
        exit 1
    }

    Write-Host "        Entpacke..." -ForegroundColor Yellow
    Expand-Archive -Path $ZIP_FILE -DestinationPath "$env:TEMP\nodejs-tmp" -Force
    $extracted = Get-ChildItem "$env:TEMP\nodejs-tmp" -Directory | Select-Object -First 1
    Move-Item $extracted.FullName $NODE_DIR -Force
    Remove-Item $ZIP_FILE -Force
    Remove-Item "$env:TEMP\nodejs-tmp" -Force -Recurse -ErrorAction SilentlyContinue
    Write-Host "        Node.js bereit." -ForegroundColor Green
} else {
    Write-Host "[1/4] Node.js gefunden." -ForegroundColor Green
}

$env:PATH = "$NODE_DIR;$env:PATH"

# ── 2. Abhängigkeiten installieren (einmalig) ───────────────────────────────
$BACKEND_MODULES = "$SCRIPT_DIR\backend\node_modules"
if (-not (Test-Path $BACKEND_MODULES)) {
    Write-Host "[2/4] Backend-Pakete werden installiert (einmalig, ~2 Min.)..." -ForegroundColor Yellow
    Push-Location "$SCRIPT_DIR\backend"
    $env:npm_config_loglevel = "error"
    & $NPM_CMD install --no-audit --no-fund --prefer-offline
    $env:npm_config_loglevel = ""
    Pop-Location
    Write-Host "        Pakete installiert." -ForegroundColor Green
} else {
    Write-Host "[2/4] Backend-Pakete vorhanden." -ForegroundColor Green
}

# ── 3. Datenbankordner anlegen ─────────────────────────────────────────────
$DATA_DIR    = "$SCRIPT_DIR\data"
$UPLOAD_DIR  = "$SCRIPT_DIR\uploads"
New-Item -ItemType Directory -Path $DATA_DIR   -Force | Out-Null
New-Item -ItemType Directory -Path $UPLOAD_DIR -Force | Out-Null

# ── 4. Ollama prüfen ───────────────────────────────────────────────────────
Write-Host "[3/4] Prüfe Ollama..." -ForegroundColor Yellow
try {
    $ollamaResp = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 3
    $models = ($ollamaResp.Content | ConvertFrom-Json).models
    $hasVision = $models | Where-Object { $_.name -like "*llama3.2-vision*" -or $_.name -like "*minicpm*" }
    if ($hasVision) {
        Write-Host "        Ollama läuft, KI-Modell gefunden." -ForegroundColor Green
    } else {
        Write-Host "        Ollama läuft, aber kein Vision-Modell gefunden." -ForegroundColor Yellow
        Write-Host "        Bitte in der Ollama-App: ollama pull llama3.2-vision" -ForegroundColor Yellow
    }
} catch {
    Write-Host "        Ollama nicht erreichbar - bitte Ollama starten!" -ForegroundColor Red
    Write-Host "        Die App startet trotzdem, KI-Analyse ist aber nicht verfügbar." -ForegroundColor Yellow
}

# ── 5. Backend starten ─────────────────────────────────────────────────────
Write-Host "[4/4] Starte Anwendung..." -ForegroundColor Yellow

$env:DATABASE_PATH = "$DATA_DIR\database.sqlite"
$env:UPLOADS_PATH  = $UPLOAD_DIR
$env:OLLAMA_HOST   = "http://localhost:11434"
$env:PORT          = "3001"
$env:NODE_ENV      = "production"

$backendJob = Start-Process -FilePath $NODE_EXE `
    -ArgumentList "$SCRIPT_DIR\backend\src\index.js" `
    -WorkingDirectory "$SCRIPT_DIR\backend" `
    -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 2

# Warten bis Backend bereit ist
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing -TimeoutSec 1
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    Write-Host ""
    Write-Host "FEHLER: Backend konnte nicht gestartet werden." -ForegroundColor Red
    Read-Host "Drücken Sie Enter zum Beenden"
    $backendJob | Stop-Process -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "        Anwendung läuft!" -ForegroundColor Green
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Öffne Browser: http://localhost:3001" -ForegroundColor White
Write-Host "  Zum Beenden: dieses Fenster schließen" -ForegroundColor White
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Browser öffnen
Start-Process "http://localhost:3001"

Write-Host "Drücken Sie Enter um die Anwendung zu beenden..." -ForegroundColor Gray
Read-Host
$backendJob | Stop-Process -ErrorAction SilentlyContinue
Write-Host "Anwendung beendet." -ForegroundColor Yellow
