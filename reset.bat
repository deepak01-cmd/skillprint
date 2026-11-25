@echo off
cd /d "%~dp0"
echo This deletes ALL data in the app and reloads the sample data on the next start.
set /p ok=Type YES to continue: 
if /i not "%ok%"=="YES" exit /b 0
docker compose down -v
echo Data removed. Run run.bat to start fresh.
pause
