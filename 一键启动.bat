@echo off
title Chess Game Server
cd /d D:\Chess_Game_Website_And_Network
set "NODE=C:\Users\czqmo\AppData\Local\Doubao\User Data\sandbox_runtime\bases\c98c5042338ed152c6f10ecd8591889f\node\node.exe"

echo ========================================
echo   Chess Game Server - One Click Start
echo ========================================
echo.

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel%==0 goto bots

echo [1/2] Starting server...
start "qiqi-server" /min "%NODE%" --openssl-legacy-provider server.js
ping -n 4 127.0.0.1 >nul
echo      Server started at http://localhost:3000
echo.

:bots
echo [2/2] Starting bot accounts...
start "bot-111" /min "%NODE%" auto_play.js 111 111
start "bot-222" /min "%NODE%" auto_play.js 222 222
start "bot-p1" /min "%NODE%" auto_play.js player1 abc123
start "bot-333" /min "%NODE%" auto_play.js 333 333
echo      4 bots started.
echo.
echo ========================================
echo   Game:  http://localhost:3000
echo   Admin: http://localhost:3000/admin.html
echo ========================================
ping -n 8 127.0.0.1 >nul
