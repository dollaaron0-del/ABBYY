@echo off
title Althoff Hotels - Rechnungsvorfilterung
color 0A

echo =============================================
echo   Althoff Hotels - Rechnungsvorfilterung
echo =============================================
echo.

:: Alten Prozess auf Port 3001 beenden
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3001 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Starte Anwendung...
echo Bitte warten...
echo.

set DATABASE_PATH=%~dp0data\database.sqlite
set UPLOADS_PATH=%~dp0uploads
set OLLAMA_HOST=http://127.0.0.1:11434
set PORT=3001
set NODE_ENV=production

if not exist "%~dp0data" mkdir "%~dp0data"
if not exist "%~dp0uploads" mkdir "%~dp0uploads"

:: Browser nach 5 Sekunden öffnen
start /b cmd /c "timeout /t 5 >nul && start http://127.0.0.1:3001"

:: Backend starten (Fenster bleibt offen)
"%USERPROFILE%\rechnungen-nodejs\node.exe" "%~dp0backend\src\index.js"

echo.
echo Anwendung beendet. Druecken Sie eine Taste...
pause >nul
