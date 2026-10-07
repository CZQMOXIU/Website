# Chess Game Website

Multi-game online platform built with Node.js + Socket.IO + SQLite.

## Games
- Gomoku (五子棋)
- Chinese Chess (中国象棋)
- International Chess (国际象棋)
- Go (围棋)
- Flying Chess (飞行棋)

## Features
- WebSocket real-time matchmaking (真人不足时自动切换人机对战)
- SQLite persistence for accounts & match records
- AES+DES encrypted passwords (Base64 transport)
- Leaderboard sorted by win rate
- Undo (3 per game) & move counter
- Admin dashboard: view accounts, game replays (GUI board), ban/unban, shutdown server
- Chinese-style UI (登录/大厅/棋盘/管理 四页)

## Quick Start
1. Install Node.js (>= 18)
2. `npm install`
3. `node --openssl-legacy-provider server.js`  (or double-click 一键启动-仅服务器.bat)
4. Open http://localhost:3000

First launch prints a random admin password in the console (or set env `ADMIN_PASSWORD`).

## Tech Stack
Node.js, Express, Socket.IO, SQLite3, Canvas (board rendering), AES-256-CBC + DES-CBC + Base64.