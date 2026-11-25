@echo off
REM Same as start-windows.bat: run WITHOUT Docker using your installed PostgreSQL.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
if errorlevel 1 pause
