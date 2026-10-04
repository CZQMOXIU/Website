# 棋类乐园 Website

五子棋 / 中国象棋 / 国际象棋 / 围棋 / 飞行棋 全栈在线对战平台。

## 技术栈

- Node.js + Express + Socket.IO
- SQLite (sqlite3@5.1.7)
- 纯前端 HTML/CSS/Canvas（无构建步骤）
- 账号加密：AES-256-CBC → DES-CBC → Base64

## 运行

```
npm install
node --openssl-legacy-provider server.js
```

> `--openssl-legacy-provider` 是因为 DES-CBC 在 OpenSSL 3+ 中属于 legacy provider。

访问 http://localhost:3000
