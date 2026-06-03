@echo off
title PropertyPilot - Dev Launcher
color 0A
echo.
echo  ============================================
echo   PropertyPilot Dev Environment Launcher
echo  ============================================
echo.

cd /d "%~dp0"

:: -----------------------------------------------
:: 1. Kill any existing processes
:: -----------------------------------------------
echo [1/6] Terminating existing processes...

taskkill /F /IM node.exe >nul 2>&1
if %errorlevel%==0 (
    echo       - Killed node.exe processes
) else (
    echo       - No node.exe processes found
)
taskkill /F /IM inngest-cli.exe >nul 2>&1

timeout /t 2 /nobreak >nul
echo       Done.
echo.

:: -----------------------------------------------
:: 2. Stop stale Supabase containers
:: -----------------------------------------------
echo [2/6] Cleaning up stale Supabase containers...
call npx supabase stop --no-backup >nul 2>&1
timeout /t 3 /nobreak >nul
echo       Done.
echo.

:: -----------------------------------------------
:: 3. Start Supabase (Docker)
:: -----------------------------------------------
echo [3/6] Starting Supabase (Docker)...
echo       Make sure Docker Desktop is running!
echo.
call npx supabase start --ignore-health-check
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Supabase failed to start. Is Docker Desktop running?
    echo  Press any key to exit...
    pause >nul
    exit /b 1
)
echo.
echo       Supabase is UP.
echo       Studio: http://127.0.0.1:54323
echo.

:: -----------------------------------------------
:: 4. Start Next.js dev server (new window)
:: -----------------------------------------------
echo [4/6] Starting Next.js dev server...
start "PropertyPilot - Next.js" cmd /k "cd /d "%~dp0" && npx pnpm dev"
timeout /t 3 /nobreak >nul
echo       Next.js started in a new window.
echo       App: http://localhost:3000
echo.

:: -----------------------------------------------
:: 5. Start Inngest dev server (new window)
:: -----------------------------------------------
echo [5/6] Starting Inngest dev server...
start "PropertyPilot - Inngest" cmd /k "cd /d "%~dp0" && npx inngest-cli dev -u http://127.0.0.1:3000/api/inngest"
timeout /t 3 /nobreak >nul
echo       Inngest started in a new window.
echo       Dashboard: http://127.0.0.1:8288
echo.

:: -----------------------------------------------
:: 6. Open browser
:: -----------------------------------------------
echo [6/6] Opening app in browser...
timeout /t 2 /nobreak >nul
start http://localhost:3000
echo.

:: -----------------------------------------------
:: Summary
:: -----------------------------------------------
echo  ============================================
echo   All services are running!
echo  ============================================
echo.
echo   App:        http://localhost:3000
echo   Supabase:   http://127.0.0.1:54323
echo   Inngest:    http://127.0.0.1:8288
echo.
echo   Close this window to keep services running.
echo   To stop everything, run: stop-dev.bat
echo  ============================================
echo.
pause
