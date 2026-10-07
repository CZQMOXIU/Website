@echo off
title Chess Game Server
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH. Install from https://nodejs.org
    pause
    exit /b
)
set "NODE=node"
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo Server already running on port 3000.
    ping -n 3 127.0.0.1 >nul
    exit /b
)
echo [1/1] Starting server...
start "chess-server" /min "%NODE%" --openssl-legacy-provider server.js
ping -n 4 127.0.0.1 >nul
echo.
echo ========================================
echo   Game : http://localhost:3000
echo   Admin: http://localhost:3000/admin.html
echo ========================================
ping -n 8 127.0.0.1 >nul
