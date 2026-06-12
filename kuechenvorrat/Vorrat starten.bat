@echo off
cd /d "%~dp0"
python vorrat.py
if errorlevel 1 (
  echo.
  echo Python wurde nicht gefunden. Bitte Python von https://www.python.org installieren
  echo und beim Installieren "Add Python to PATH" anhaken.
  pause
)
