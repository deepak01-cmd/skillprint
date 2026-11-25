@echo off
REM Role & Skill Intelligence Platform - start with Docker Desktop (Windows)
cd /d "%~dp0"
echo.
echo  Role ^& Skill Intelligence Platform
echo  ---------------------------------
docker info >nul 2>&1
if errorlevel 1 (
  echo  Docker is not running. Start Docker Desktop, wait until it says "Engine running", then run this file again.
  pause
  exit /b 1
)
echo  Building and starting (the first run takes 3-6 minutes)...
docker compose up -d --build
if errorlevel 1 (
  echo  Docker could not start the app. See the messages above.
  pause
  exit /b 1
)
echo  Waiting for the app to finish loading the sample data...
set /a tries=0
:wait
set /a tries+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:3000/api/v1/health; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready
if %tries% GEQ 120 (
  echo  The app did not answer after 6 minutes. Showing its log:
  docker compose logs --tail 80 app
  pause
  exit /b 1
)
timeout /t 3 /nobreak >nul
goto wait
:ready
echo.
echo  Ready:  http://localhost:3000
echo  Sign in with any demo account on the login page. Password: demo1234
echo  To stop: run stop.bat
start "" http://localhost:3000
pause
