@echo off
title PropertyPilot - Stopping All Services
color 0C
echo.
echo  ============================================
echo   PropertyPilot - Stopping All Services
echo  ============================================
echo.

cd /d "%~dp0"

echo [1/3] Killing Node.js processes (Next.js, Inngest)...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM inngest-cli.exe >nul 2>&1
echo       Done.

echo [2/3] Stopping Supabase containers...
call npx supabase stop
echo       Done.

echo [3/3] Cleanup complete.
echo.
echo  ============================================
echo   All services stopped.
echo  ============================================
echo.
pause
