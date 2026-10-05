# 棋类乐园 Website

五子棋 / 中国象棋 / 国际象棋 / 围棋 / 飞行棋 全栈在线对战平台。

## 技术栈

- Node.js + Express + Socket.IO
- SQLite (sqlite3@5.1.7)
- 纯前端 HTML/CSS/Canvas（无构建步骤）
- 账号加密：AES-256-CBC → DES-CBC → Base64（兼容旧 MD5）

## 运行

```
npm install
node --openssl-legacy-provider server.js
```

> `--openssl-legacy-provider` 是因为 DES-CBC 在 OpenSSL 3+ 中属于 legacy provider。

访问 http://localhost:3000

## 功能

- 真人匹配对战 + 人机对战（AI 速度/强度可调，35% 概率犯傻）
- 五子棋悔棋（人机模式一局 3 次）
- 排行榜（按胜率排序）+ 每局手数统计
- 在线人数按用户去重统计
- 机器人自动对弈：`node auto_play.js 用户名 密码`（随机进入某棋类匹配）
- 一键启动：`一键启动-仅服务器.bat` / `一键启动-带机器人.bat`

## 管理后台

访问 http://localhost:3000/admin.html（管理员账号见服务器目录 admin_password.txt）

- 查看用户用户名与明文密码（旧 MD5 格式标注不可逆）
- 封号 / 解封（用户与机器人通用，封号即踢下线）
- 查看对局记录与完整棋谱，GUI 棋盘逐手回放（五种棋类均可）
- 强行停止服务器
