@echo off
REM Run on Windows WITHOUT Docker, using your installed PostgreSQL. Double-click this file.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
if errorlevel 1 pause
