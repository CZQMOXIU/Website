// ============================================================
// 棋类乐园 - 全栈对战服务器 (五子棋/中国象棋/国际象棋/围棋/飞行棋)
// 运行: node --openssl-legacy-provider server.js
// ============================================================
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const PORT = 3000;
const DB_PATH = path.join(__dirname, 'gobang.db');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- 数据库 ----------------
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    win INTEGER DEFAULT 0,
    lose INTEGER DEFAULT 0,
    draw INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS game_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid INTEGER NOT NULL,
    game TEXT NOT NULL,
    opponent TEXT NOT NULL,
    result TEXT NOT NULL,
    moves INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);
  // 迁移: 封号字段 + 对局棋谱字段(老库自动补列)
  db.run('ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0', () => {});
  db.run('ALTER TABLE game_logs ADD COLUMN moves_data TEXT', () => {});
  // 初始化管理员
  db.get('SELECT id FROM admins WHERE username = ?', ['admin'], (err, row) => {
    if (!row) db.run('INSERT INTO admins (username, password) VALUES (?, ?)', ['admin', encryptPassword('admin123')]);
  });
});

// ---------------- 密码加密: MD5(兼容旧) + AES-256-CBC + DES-CBC + Base64 ----------------
function md5(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex');
}
const AES_KEY = crypto.createHash('sha256').update('gobang-secret-key-2026').digest();
const AES_IV = Buffer.from('gobang-iv-000001', 'utf8');
const DES_KEY = crypto.createHash('md5').update('gobang-des-key').digest().slice(0, 8);
const DES_IV = Buffer.from('gobang08', 'utf8');

function encryptPassword(pwd) {
  const aesCipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, AES_IV);
  let aesOut = aesCipher.update(String(pwd), 'utf8');
  aesOut = Buffer.concat([aesOut, aesCipher.final()]);
  const desCipher = crypto.createCipheriv('des-cbc', DES_KEY, DES_IV);
  let desOut = desCipher.update(aesOut);
  desOut = Buffer.concat([desOut, desCipher.final()]);
  return desOut.toString('base64');
}

function verifyPassword(input, stored) {
  try { if (encryptPassword(input) === stored) return true; } catch (e) {}
  if (md5(input) === stored) return true;
  return false;
}

function getRawPassword(p) {
  if (typeof p !== 'string' || !p) return p || '';
  try {
    const dec = Buffer.from(p, 'base64').toString('utf8');
    if (dec && !/[\uFFFD]/.test(dec)) return dec;
  } catch (e) {}
  return p;
}

// 管理员查看明文密码: 解密 AES-256-CBC -> DES-CBC
function decryptPassword(stored) {
  try {
    const buf = Buffer.from(String(stored), 'base64');
    const desDec = crypto.createDecipheriv('des-cbc', DES_KEY, DES_IV);
    let aes = Buffer.concat([desDec.update(buf), desDec.final()]);
    const aesDec = crypto.createDecipheriv('aes-256-cbc', AES_KEY, AES_IV);
    let out = Buffer.concat([aesDec.update(aes), aesDec.final()]);
    return out.toString('utf8');
  } catch (e) {
    return null;
  }
}

// ---------------- HTTP API ----------------
app.post('/api/register', (req, res) => {
  const username = (req.body && req.body.username || '').toString().trim();
  const password = getRawPassword(req.body && req.body.password);
  if (!username || !password) return res.json({ code: 1, msg: '用户名和密码不能为空' });
  db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
    if (row) return res.json({ code: 1, msg: '用户名已存在' });
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, encryptPassword(password)], (e) => {
      if (e) return res.json({ code: 1, msg: '注册失败' });
      res.json({ code: 0, msg: '注册成功，请登录' });
    });
  });
});

app.post('/api/login', (req, res) => {
  const username = (req.body && req.body.username || '').toString().trim();
  const password = getRawPassword(req.body && req.body.password);
  if (!username || !password) return res.json({ code: 1, msg: '用户名和密码不能为空' });
  db.get('SELECT id, username, password, win, lose, draw, banned FROM users WHERE username = ?', [username], (err, row) => {
    if (!row || !verifyPassword(password, row.password)) return res.json({ code: 1, msg: '用户名或密码错误' });
    if (row.banned) return res.json({ code: 1, msg: '该账号已被封禁，请联系管理员' });
    res.json({ code: 0, msg: '登录成功', data: { id: row.id, username: row.username, win: row.win, lose: row.lose, draw: row.draw } });
  });
});

app.post('/api/admin/login', (req, res) => {
  const username = (req.body && req.body.username || '').toString().trim();
  const password = getRawPassword(req.body && req.body.password);
  if (!username || !password) return res.json({ code: 1, msg: '请输入账号密码' });
  db.get('SELECT id, password FROM admins WHERE username = ?', [username], (err, row) => {
    if (!row || !verifyPassword(password, row.password)) return res.json({ code: 1, msg: '管理员账号或密码错误' });
    res.json({ code: 0, msg: 'ok' });
  });
});

// 排行榜: 按胜率排序
app.get('/api/leaderboard', (req, res) => {
  db.all('SELECT username, win, lose, draw FROM users ORDER BY (CAST(win AS REAL) / MAX((win+lose+draw),1)) DESC, win DESC LIMIT 50', (err, rows) => {
    rows.forEach(r => {
      r.winRate = (r.win + r.lose + r.draw) > 0 ? Math.round(r.win / (r.win + r.lose + r.draw) * 100) : 0;
      r.total = r.win + r.lose + r.draw;
    });
    res.json({ code: 0, data: rows });
  });
});

// 管理后台
app.get('/api/admin/summary', (req, res) => {
  db.get('SELECT (SELECT COUNT(*) FROM users) AS totalUsers, (SELECT COUNT(*) FROM game_logs) AS totalGames, (SELECT COUNT(*) FROM game_logs WHERE result="win") AS totalWins, (SELECT COUNT(*) FROM game_logs WHERE result="lose") AS totalLoses, (SELECT COUNT(*) FROM game_logs WHERE result="draw") AS totalDraws', (e, row) => {
    res.json({ code: 0, data: { ...row, online: onlineUsers.size } });
  });
});
app.get('/api/admin/users', (req, res) => {
  db.all('SELECT id, username, password, win, lose, draw, banned, created_at FROM users ORDER BY id DESC', (e, rows) => {
    rows.forEach(u => {
      const plain = decryptPassword(u.password);
      u.password = plain !== null ? plain : '[MD5旧格式，不可逆]';
      u.banned = !!u.banned;
    });
    res.json({ code: 0, data: rows });
  });
});
app.get('/api/admin/games', (req, res) => {
  db.all('SELECT g.id, u.username, g.game, g.opponent, g.result, g.moves, g.created_at FROM game_logs g LEFT JOIN users u ON g.uid = u.id ORDER BY g.id DESC LIMIT 200', (e, rows) => res.json({ code: 0, data: rows }));
});
// 对局详情: 返回完整棋谱(moves_data)供GUI棋盘回放
app.get('/api/admin/game', (req, res) => {
  const id = parseInt(req.query.id);
  if (!id) return res.json({ code: 1, msg: '缺少对局ID' });
  db.get('SELECT g.id, u.username, g.game, g.opponent, g.result, g.moves, g.created_at, g.moves_data FROM game_logs g LEFT JOIN users u ON g.uid = u.id WHERE g.id = ?', [id], (e, row) => {
    if (!row) return res.json({ code: 1, msg: '对局不存在' });
    let steps = [];
    try { steps = row.moves_data ? JSON.parse(row.moves_data) : []; } catch (err) { steps = []; }
    delete row.moves_data;
    res.json({ code: 0, data: { ...row, steps } });
  });
});
// 封号/解封 (用户与机器人通用)
app.post('/api/admin/ban', (req, res) => {
  const id = parseInt(req.body && req.body.id);
  const banned = (req.body && req.body.banned) ? 1 : 0;
  if (!id) return res.json({ code: 1, msg: '参数错误' });
  db.run('UPDATE users SET banned = ? WHERE id = ?', [banned, id], (e) => {
    if (e) return res.json({ code: 1, msg: '操作失败' });
    if (banned) {
      // 封号即踢下线: 先通知再断开
      const sid = userSockets.get(id);
      if (sid) {
        const s = io.sockets.sockets.get(sid);
        if (s) { s.emit('banned', { msg: '该账号已被封禁' }); s.disconnect(true); }
      }
      onlineUsers.delete(id);
      userSockets.delete(id);
      // 同时清出所有匹配队列
      for (const [game, queue] of matchQueue) {
        const idx = queue.findIndex(q => q.uid === id);
        if (idx !== -1) queue.splice(idx, 1);
      }
      io.emit('onlineCount', onlineUsers.size);
    }
    res.json({ code: 0, msg: banned ? '已封禁该账号' : '已解封该账号' });
  });
});
// 强行停止服务器
app.post('/api/admin/shutdown', (req, res) => {
  res.json({ code: 0, msg: '服务器正在关闭…' });
  setTimeout(() => {
    try { io.close(); server.close(); } catch (e) {}
    setTimeout(() => process.exit(0), 400);
  }, 300);
});

// ---------------- 游戏引擎 ----------------

// 五子棋
function newGobang() {
  return { board: Array.from({ length: 15 }, () => Array(15).fill(0)), turn: 0, movesCount: 0, undo: [0, 0], lastMove: null };
}
function checkGobang(board, x, y, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    let cnt = 1;
    for (const sign of [1, -1]) {
      for (let i = 1; i < 5; i++) {
        const nx = x + dx * i * sign, ny = y + dy * i * sign;
        if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15 || board[ny][nx] !== color) break;
        cnt++;
      }
    }
    if (cnt >= 5) return true;
  }
  return false;
}
function aiGobang(board, myColor) {
  let has = false;
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) if (board[y][x] !== 0) { has = true; break; }
  if (!has) return { x: 7, y: 7 };
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const scorePoint = (x, y, color) => {
    let total = 0;
    for (const [dx, dy] of dirs) {
      let cnt = 1, open = 0;
      for (const sign of [1, -1]) {
        for (let i = 1; i < 5; i++) {
          const nx = x + dx * i * sign, ny = y + dy * i * sign;
          if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15) break;
          if (board[ny][nx] === color) cnt++;
          else if (board[ny][nx] === 0) { open++; break; }
          else break;
        }
      }
      if (cnt >= 5) total += 1000000;
      else if (cnt === 4) total += open >= 2 ? 100000 : 10000;
      else if (cnt === 3) total += open >= 2 ? 5000 : 500;
      else if (cnt === 2) total += open >= 2 ? 200 : 20;
    }
    return total;
  };
  let best = null, bestScore = -Infinity;
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      if (board[y][x] !== 0) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && board[ny][nx] !== 0) { near = true; break; }
      }
      if (!near) continue;
      const s = scorePoint(x, y, myColor) + scorePoint(x, y, myColor === 1 ? 2 : 1) * 0.9;
      if (s > bestScore) { bestScore = s; best = { x, y }; }
    }
  }
  return best || { x: 7, y: 7 };
}

// 中国象棋
function newXiangqi() {
  const board = [
    [2, 3, 4, 5, 6, 5, 4, 3, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 7, 0, 0, 0, 0, 0, 7, 0],
    [1, 0, 1, 0, 1, 0, 1, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [11, 0, 11, 0, 11, 0, 11, 0, 11],
    [0, 17, 0, 0, 0, 0, 0, 17, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [12, 13, 14, 15, 16, 15, 14, 13, 12]
  ];
  return { board, turn: 0, movesCount: 0 };
}
function xiangqiLegal(board, from, to, color) {
  const [fx, fy] = from, [tx, ty] = to;
  if (fx < 0 || fx > 8 || fy < 0 || fy > 9 || tx < 0 || tx > 8 || ty < 0 || ty > 9) return false;
  const v = board[fy][fx];
  if (v === 0 || (color === 1 ? v > 7 : v < 11)) return false;
  if (board[ty][tx] !== 0 && (color === 1 ? board[ty][tx] > 7 : board[ty][tx] < 11)) return false;
  const kind = v % 10;
  if (kind === 6) { // 帅/将
    if (tx === fx || ty === fy) {
      const step = Math.abs(tx - fx) + Math.abs(ty - fy);
      if (step === 1 && tx >= 3 && tx <= 5 && (color === 1 ? ty >= 0 && ty <= 2 : ty >= 7 && ty <= 9)) return true;
    }
    return false;
  }
  if (kind === 5) { // 士/仕
    if (Math.abs(tx - fx) === 1 && Math.abs(ty - fy) === 1 && tx >= 3 && tx <= 5 && (color === 1 ? ty >= 0 && ty <= 2 : ty >= 7 && ty <= 9)) return true;
    return false;
  }
  if (kind === 4) { // 象/相
    if (Math.abs(tx - fx) === 2 && Math.abs(ty - fy) === 2) {
      if (color === 1 ? ty > 4 : ty < 5) return false;
      if (board[fy + (ty - fy) / 2][fx + (tx - fx) / 2] === 0) return true;
    }
    return false;
  }
  if (kind === 3) { // 马
    const dx = tx - fx, dy = ty - fy;
    if (Math.abs(dx) === 2 && Math.abs(dy) === 1) {
      if (board[fy][fx + dx / 2] === 0) return true;
    } else if (Math.abs(dx) === 1 && Math.abs(dy) === 2) {
      if (board[fy + dy / 2][fx] === 0) return true;
    }
    return false;
  }
  if (kind === 2) { // 车
    if (tx !== fx && ty !== fy) return false;
    const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
    for (let x = fx + dx, y = fy + dy; x !== tx || y !== ty; x += dx, y += dy) {
      if (board[y][x] !== 0) return false;
    }
    return true;
  }
  if (kind === 1) { // 炮
    if (tx !== fx && ty !== fy) return false;
    const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
    let cnt = 0;
    for (let x = fx + dx, y = fy + dy; x !== tx || y !== ty; x += dx, y += dy) {
      if (board[y][x] !== 0) cnt++;
    }
    return cnt === 0 ? board[ty][tx] === 0 : cnt === 1 && board[ty][tx] !== 0;
  }
  if (kind === 7) { // 兵/卒
    const f = color === 1 ? -1 : 1;
    if (ty - fy === f && tx === fx) return true;
    if (color === 1 ? fy < 5 : fy > 4) {
      if (ty === fy && Math.abs(tx - fx) === 1) return true;
    }
    return false;
  }
  return false;
}
function aiXiangqi(board, myColor) {
  const cands = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const v = board[y][x];
    if (v === 0 || (myColor === 1 ? v > 7 : v < 11)) continue;
    for (let ty = 0; ty < 10; ty++) for (let tx = 0; tx < 9; tx++) {
      if (board[ty][tx] !== 0 && (myColor === 1 ? board[ty][tx] > 7 : board[ty][tx] < 11)) continue;
      if (xiangqiLegal(board, [x, y], [tx, ty], myColor)) {
        let score = 0;
        if (board[ty][tx] !== 0) score += 100; // 吃子优先
        if (v % 10 === 6) score -= 500;        // 别送帅
        score += Math.random() * 5;
        cands.push({ fx: x, fy: y, tx, ty, score });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.length ? cands[0] : null;
}

// 国际象棋
function newChess() {
  const board = [
    [2, 3, 4, 5, 6, 4, 3, 2],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [11, 11, 11, 11, 11, 11, 11, 11],
    [12, 13, 14, 15, 16, 14, 13, 12]
  ];
  return { board, turn: 0, movesCount: 0 };
}
function chessLegal(board, from, to, color) {
  const [fx, fy] = from, [tx, ty] = to;
  if (fx < 0 || fx > 7 || fy < 0 || fy > 7 || tx < 0 || tx > 7 || ty < 0 || ty > 7) return false;
  const v = board[fy][fx];
  if (v === 0 || (color === 1 ? v > 6 : v < 11)) return false;
  if (board[ty][tx] !== 0 && (color === 1 ? board[ty][tx] > 6 : board[ty][tx] < 11)) return false;
  const kind = v % 10;
  if (kind === 1) { // 兵
    const f = color === 1 ? 1 : -1;
    if (tx === fx && ty - fy === f && board[ty][tx] === 0) return true;
    if (tx === fx && ty - fy === f * 2 && fy === (color === 1 ? 1 : 6) && board[fy + f][fx] === 0 && board[ty][tx] === 0) return true;
    if (Math.abs(tx - fx) === 1 && ty - fy === f && board[ty][tx] !== 0) return true;
    return false;
  }
  if (kind === 2) { // 车
    if (tx !== fx && ty !== fy) return false;
    const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
    for (let x = fx + dx, y = fy + dy; x !== tx || y !== ty; x += dx, y += dy) if (board[y][x] !== 0) return false;
    return true;
  }
  if (kind === 3) { // 马
    if ((Math.abs(tx - fx) === 2 && Math.abs(ty - fy) === 1) || (Math.abs(tx - fx) === 1 && Math.abs(ty - fy) === 2)) return true;
    return false;
  }
  if (kind === 4) { // 象
    if (Math.abs(tx - fx) !== Math.abs(ty - fy) || tx === fx) return false;
    const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
    for (let x = fx + dx, y = fy + dy; x !== tx || y !== ty; x += dx, y += dy) if (board[y][x] !== 0) return false;
    return true;
  }
  if (kind === 5) { // 后
    if (tx === fx || ty === fy || Math.abs(tx - fx) === Math.abs(ty - fy)) {
      const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
      for (let x = fx + dx, y = fy + dy; x !== tx || y !== ty; x += dx, y += dy) if (board[y][x] !== 0) return false;
      return true;
    }
    return false;
  }
  if (kind === 6) { // 王
    if (Math.max(Math.abs(tx - fx), Math.abs(ty - fy)) === 1) return true;
    return false;
  }
  return false;
}
function aiChess(board, myColor) {
  const cands = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = board[y][x];
    if (v === 0 || (myColor === 1 ? v > 6 : v < 11)) continue;
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      if (board[ty][tx] !== 0 && (myColor === 1 ? board[ty][tx] > 6 : board[ty][tx] < 11)) continue;
      if (chessLegal(board, [x, y], [tx, ty], myColor)) {
        let score = board[ty][tx] ? 100 : 0;
        if (board[ty][tx] % 10 === 6) score += 900;
        score += Math.random() * 5;
        cands.push({ fx: x, fy: y, tx, ty, score });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.length ? cands[0] : null;
}

// 围棋
function newGo() {
  const N = 13;
  return { board: Array.from({ length: N }, () => Array(N).fill(0)), turn: 0, passes: 0, movesCount: 0, N };
}
function goCapture(board, x, y, color) {
  const N = board.length;
  const opp = color === 1 ? 2 : 1;
  const visited = new Set();
  const isDead = (sx, sy) => {
    if (visited.has(sx + ',' + sy)) return null;
    const stack = [[sx, sy]], group = [];
    let hasLiberty = false;
    visited.add(sx + ',' + sy);
    while (stack.length) {
      const [cx, cy] = stack.pop();
      group.push([cx, cy]);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
        const k = nx + ',' + ny;
        if (board[ny][nx] === 0) { hasLiberty = true; continue; }
        if (board[ny][nx] === opp && !visited.has(k)) { visited.add(k); stack.push([nx, ny]); }
      }
    }
    return !hasLiberty ? group : null;
  };
  let captured = 0;
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
    if (board[ny][nx] === opp) {
      const dead = isDead(nx, ny);
      if (dead) { dead.forEach(([cx, cy]) => { board[cy][cx] = 0; captured++; }); }
    }
  }
  return captured;
}
function goSuicide(board, x, y, color) {
  const N = board.length;
  board[y][x] = color;
  const opp = color === 1 ? 2 : 1;
  let hasLiberty = false;
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
    if (board[ny][nx] === 0) hasLiberty = true;
  }
  board[y][x] = 0;
  return !hasLiberty;
}
function aiGo(board) {
  const N = board.length;
  let best = null, bestScore = -Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (board[y][x] !== 0) continue;
    if (goSuicide(board, x, y, board.length === N ? 1 : 1)) continue;
    let near = 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < N && ny >= 0 && ny < N && board[ny][nx] !== 0) near++;
    }
    const score = near * 10 + Math.random() * 3;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

// 飞行棋
function flyDice() { return Math.floor(Math.random() * 6) + 1; }
function newFlying() {
  return {
    players: [
      { pos: [-1, -1, -1, -1], finished: [false, false, false, false], name: '玩家1', color: '#ff5252' },
      { pos: [-1, -1, -1, -1], finished: [false, false, false, false], name: '玩家2', color: '#448aff' },
      { pos: [-1, -1, -1, -1], finished: [false, false, false, false], name: '玩家3', color: '#43a047' },
      { pos: [-1, -1, -1, -1], finished: [false, false, false, false], name: '玩家4', color: '#ffb300' }
    ].slice(0, 2),
    turn: 0, dice: 0, movesCount: 0
  };
}
// 飞行棋经典规则: 4人共跑道52格, 第i家从格0起飞, 走52圈; 简化2-4人同规则
const FLY_TRACK = 52;
function flyMovePlane(players, pi, plane, dice) {
  const p = players[pi];
  if (p.pos[plane] === -1) {
    if (dice !== 6) return { ok: false };
    p.pos[plane] = 0;
  } else {
    p.pos[plane] = (p.pos[plane] + dice) % FLY_TRACK;
    // 到达终点
    if (p.pos[plane] + dice >= FLY_TRACK) {
      p.finished[plane] = true;
      p.pos[plane] = -1;
      return { ok: true, finished: true };
    }
  }
  // 踩人: 同格其他玩家飞机回停机坪
  for (let j = 0; j < players.length; j++) {
    if (j === pi) continue;
    for (let k = 0; k < 4; k++) {
      if (!players[j].finished[k] && players[j].pos[k] === p.pos[plane] && p.pos[plane] !== -1) {
        players[j].pos[k] = -1;
      }
    }
  }
  return { ok: true };
}
function aiMoveFlying(players, pi, dice) {
  const p = players[pi];
  // 能起飞就起飞
  for (let k = 0; k < 4; k++) if (p.pos[k] === -1 && !p.finished[k]) return k;
  // 否则走最远的
  let best = -1, bestPos = -Infinity;
  for (let k = 0; k < 4; k++) {
    if (!p.finished[k] && p.pos[k] > bestPos) { bestPos = p.pos[k]; best = k; }
  }
  return best;
}

// ---------------- 房间管理 ----------------
const rooms = new Map();
const matchQueue = new Map(); // game -> [{uid, socketId, user}]
const onlineUsers = new Map(); // uid -> username (去重在线统计)
const userSockets = new Map(); // uid -> socketId

const GAME_NAMES = { gobang: '五子棋', xiangqi: '中国象棋', chess: '国际象棋', go: '围棋', flying: '飞行棋' };
const AI_NAMES = ['AI-小棋', 'AI-大师', 'AI-迅捷'];

function createRoom(game, players) {
  const roomId = Math.random().toString(36).slice(2, 10);
  let state;
  if (game === 'gobang') state = newGobang();
  else if (game === 'xiangqi') state = newXiangqi();
  else if (game === 'chess') state = newChess();
  else if (game === 'go') state = newGo();
  else if (game === 'flying') { state = newFlying(); }
  const room = { roomId, game, players, state, gameOver: false, aiTimer: null, movesData: [JSON.parse(JSON.stringify(state))] };
  if (game === 'flying') {
    state.players.forEach((p, i) => { p.name = players[i] ? players[i].name : '玩家' + (i + 1); });
  }
  rooms.set(roomId, room);
  return room;
}

function emitGameState(room, record) {
  if (record) room.movesData.push(JSON.parse(JSON.stringify(room.state)));
  io.to(room.roomId).emit('gameState', {
    roomId: room.roomId, game: room.game, state: room.state,
    turn: room.state.turn, gameOver: room.gameOver
  });
}

function endGame(room, winnerIdx, reason) {
  if (room.gameOver) return;
  room.gameOver = true;
  // 终局快照入棋谱
  room.movesData.push(JSON.parse(JSON.stringify(room.state)));
  const movesDataStr = JSON.stringify(room.movesData);
  const loserIdx = winnerIdx === 0 ? 1 : 0;
  const isAI = room.players.some(p => p.isAI);
  if (!isAI) {
    // 真人vs真人
    room.players[winnerIdx].socket.emit('gameOver', { winnerName: room.players[winnerIdx].name, reason });
    room.players[loserIdx].socket.emit('gameOver', { winnerName: room.players[winnerIdx].name, reason });
    db.run('UPDATE users SET win = win + 1 WHERE id = ?', [room.players[winnerIdx].uid]);
    db.run('UPDATE users SET lose = lose + 1 WHERE id = ?', [room.players[loserIdx].uid]);
    db.run('INSERT INTO game_logs (uid, game, opponent, result, moves, moves_data) VALUES (?,?,?,?,?,?)', [room.players[winnerIdx].uid, room.game, room.players[loserIdx].name, 'win', room.state.movesCount || 0, movesDataStr]);
    db.run('INSERT INTO game_logs (uid, game, opponent, result, moves, moves_data) VALUES (?,?,?,?,?,?)', [room.players[loserIdx].uid, room.game, room.players[winnerIdx].name, 'lose', room.state.movesCount || 0, movesDataStr]);
  } else {
    // 人机
    const human = room.players.find(p => !p.isAI);
    const ai = room.players.find(p => p.isAI);
    if (human) {
      if (winnerIdx === 0) {
        human.socket.emit('gameOver', { winnerName: human.name, reason });
        db.run('UPDATE users SET win = win + 1 WHERE id = ?', [human.uid]);
        db.run('INSERT INTO game_logs (uid, game, opponent, result, moves, moves_data) VALUES (?,?,?,?,?,?)', [human.uid, room.game, ai.name, 'win', room.state.movesCount || 0, movesDataStr]);
      } else {
        human.socket.emit('gameOver', { winnerName: ai.name, reason });
        db.run('UPDATE users SET lose = lose + 1 WHERE id = ?', [human.uid]);
        db.run('INSERT INTO game_logs (uid, game, opponent, result, moves, moves_data) VALUES (?,?,?,?,?,?)', [human.uid, room.game, ai.name, 'lose', room.state.movesCount || 0, movesDataStr]);
      }
    }
  }
  room.players.forEach(p => { if (p.socket && !p.isAI) p.socket.emit('roomEnd'); });
  setTimeout(() => rooms.delete(room.roomId), 2000);
  io.emit('onlineCount', onlineUsers.size);
}

function checkGameEnd(room, winnerIdx, reason) {
  endGame(room, winnerIdx, reason);
}

function startAITurn(room) {
  if (room.gameOver) return;
  const aiIdx = room.players.findIndex(p => p.isAI);
  if (aiIdx === -1 || room.state.turn !== aiIdx) return;
  const ai = room.players[aiIdx];
  const delay = 700 + Math.random() * 600;
  // 35% 犯傻: 从合法走法中随机选(放弃最优)
  room.aiTimer = setTimeout(() => {
    if (room.gameOver || room.state.turn !== aiIdx) return;
    const s = room.state;
    if (room.game === 'gobang') {
      let pos = aiGobang(s.board, aiIdx === 0 ? 1 : 2);
      if (Math.random() < 0.35) {
        const empty = [];
        for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) if (s.board[y][x] === 0) empty.push({ x, y });
        if (empty.length) pos = empty[Math.floor(Math.random() * empty.length)];
      }
      s.board[pos.y][pos.x] = aiIdx === 0 ? 1 : 2;
      s.movesCount++;
      if (checkGobang(s.board, pos.x, pos.y, aiIdx === 0 ? 1 : 2)) return checkGameEnd(room, aiIdx, '五子连珠');
      s.turn = 1 - s.turn;
      emitGameState(room, true);
    } else if (room.game === 'xiangqi') {
      let m = aiXiangqi(s.board, aiIdx + 1);
      if (Math.random() < 0.35) {
        const all = [];
        for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
          const v = s.board[y][x];
          if (v === 0 || (aiIdx + 1 === 1 ? v > 7 : v < 11)) continue;
          for (let ty = 0; ty < 10; ty++) for (let tx = 0; tx < 9; tx++) {
            if (s.board[ty][tx] !== 0 && (aiIdx + 1 === 1 ? s.board[ty][tx] > 7 : s.board[ty][tx] < 11)) continue;
            if (xiangqiLegal(s.board, [x, y], [tx, ty], aiIdx + 1)) all.push({ fx: x, fy: y, tx, ty });
          }
        }
        if (all.length) m = all[Math.floor(Math.random() * all.length)];
      }
      if (!m) return;
      s.board[m.ty][m.tx] = s.board[m.fy][m.fx];
      s.board[m.fy][m.fx] = 0;
      s.movesCount++;
      if (s.board[m.ty][m.tx] % 10 === 6) return checkGameEnd(room, aiIdx, '吃掉对方将帅');
      s.turn = 1 - s.turn;
      emitGameState(room, true);
    } else if (room.game === 'chess') {
      let m = aiChess(s.board, aiIdx + 1);
      if (Math.random() < 0.35) {
        const all = [];
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const v = s.board[y][x];
          if (v === 0 || (aiIdx + 1 === 1 ? v > 6 : v < 11)) continue;
          for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
            if (s.board[ty][tx] !== 0 && (aiIdx + 1 === 1 ? s.board[ty][tx] > 6 : s.board[ty][tx] < 11)) continue;
            if (chessLegal(s.board, [x, y], [tx, ty], aiIdx + 1)) all.push({ fx: x, fy: y, tx, ty });
          }
        }
        if (all.length) m = all[Math.floor(Math.random() * all.length)];
      }
      if (!m) return;
      s.board[m.ty][m.tx] = s.board[m.fy][m.fx];
      s.board[m.fy][m.fx] = 0;
      s.movesCount++;
      if (s.board[m.ty][m.tx] % 10 === 6) return checkGameEnd(room, aiIdx, '吃掉对方国王');
      s.turn = 1 - s.turn;
      emitGameState(room, true);
    } else if (room.game === 'go') {
      const pos = aiGo(s.board);
      if (!pos) {
        s.passes++;
        if (s.passes >= 2) return checkGameEnd(room, 1 - aiIdx, '双方连续虚手');
        s.turn = 1 - s.turn;
        emitGameState(room, true);
        return;
      }
      s.passes = 0;
      s.board[pos.y][pos.x] = aiIdx === 0 ? 1 : 2;
      goCapture(s.board, pos.x, pos.y, aiIdx === 0 ? 1 : 2);
      s.movesCount++;
      s.turn = 1 - s.turn;
      emitGameState(room, true);
    } else if (room.game === 'flying') {
      if (s.dice === 0) {
        s.dice = flyDice();
        const p = s.players[aiIdx];
        const movable = [0,1,2,3].some(k => !p.finished[k] && (s.dice === 6 || p.pos[k] !== -1));
        if (movable) {
          const chosen = aiMoveFlying(s.players, aiIdx, s.dice);
          if (chosen !== null) {
            const r = flyMovePlane(s.players, aiIdx, chosen, s.dice);
            if (r.ok) {
              s.movesCount++;
              if (s.players[aiIdx].finished.filter(Boolean).length === 4) return checkGameEnd(room, aiIdx, '全部到达终点');
              if (s.dice !== 6) s.turn = (s.turn + 1) % s.players.length;
              s.dice = 0;
              emitGameState(room, true);
              return;
            }
          }
        }
        s.turn = (s.turn + 1) % s.players.length;
        s.dice = 0;
        emitGameState(room, true);
        return;
      }
    }
  }, delay);
}

function maybeAITurn(room) {
  const aiIdx = room.players.findIndex(p => p.isAI);
  if (aiIdx !== -1 && room.state.turn === aiIdx && !room.gameOver) startAITurn(room);
}

// ---------------- Socket ----------------
io.on('connection', (socket) => {
  // 封禁拦截: 所有入口统一检查
  function checkBanned(user, cb) {
    if (!user || !user.id) return cb(false);
    db.get('SELECT banned FROM users WHERE id = ?', [user.id], (e, row) => {
      if (row && row.banned) {
        socket.emit('banned', { msg: '该账号已被封禁，无法进入' });
        socket.disconnect(true);
        return cb(true);
      }
      cb(false);
    });
  }

  socket.on('loginSocket', (user) => {
    checkBanned(user, (banned) => {
      if (banned) return;
      socket.data.user = user;
      onlineUsers.set(user.id, user.username);
      userSockets.set(user.id, socket.id);
      io.emit('onlineCount', onlineUsers.size);
    });
  });

  socket.on('matchmake', ({ game, user }) => {
    if (!user) return;
    checkBanned(user, (banned) => {
      if (banned) return;
      if (!matchQueue.has(game)) matchQueue.set(game, []);
      const queue = matchQueue.get(game);
      // 同一用户同棋类不重复排队
      if (queue.some(q => q.user.id === user.id)) return;
      queue.push({ uid: user.id, socketId: socket.id, user, socket });
      socket.emit('waiting', { game });
      // 尝试配对
      setTimeout(() => tryMatch(game), 50);
    });
  });

  socket.on('cancelMatch', ({ game, user }) => {
    if (!matchQueue.has(game)) return;
    const queue = matchQueue.get(game);
    const idx = queue.findIndex(q => q.user && q.user.id === user.id);
    if (idx !== -1) queue.splice(idx, 1);
  });

  socket.on('aiStart', ({ game, user }) => {
    if (!user) return;
    checkBanned(user, (banned) => {
      if (banned) return;
      // 人机对弈
      const aiIdx = 1;
      const aiName = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
      const human = { uid: user.id, socket, name: user.username, isAI: false, color: 0 };
      const ai = { uid: -1, socket: null, name: aiName, isAI: true, color: 1 };
      const room = createRoom(game, [human, ai]);
      human.socket.join(room.roomId);
      socket.emit('gameStart', { roomId: room.roomId, game, color: 0, opponentName: aiName });
      setTimeout(() => emitGameState(room), 100);
      maybeAITurn(room);
    });
  });

  socket.on('joinRoom', ({ roomId, user }) => {
    if (!user) return;
    checkBanned(user, (banned) => {
      if (banned) return;
      const room = rooms.get(roomId);
      if (!room) return socket.emit('roomNotFound');
      const p = room.players.find(x => x.uid === user.id);
      if (p) {
        socket.join(roomId);
        p.socket = socket;
        if (room.gameOver) {
          // 宽限8秒: 对局结束则发送结束信息
          const winnerIdx = room.players.findIndex(x => x.uid !== user.id);
          socket.emit('gameOver', { winnerName: room.players[winnerIdx].name, reason: '对局已结束' });
          socket.emit('roomEnd');
        } else {
          emitGameState(room);
        }
      }
    });
  });

  socket.on('place', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.gameOver) return;
    const meIdx = room.players.findIndex(p => p.socket && p.socket.id === socket.id);
    if (meIdx === -1) return;
    if (room.state.turn !== meIdx) return;
    const g = room.game;
    let moved = false;

    if (g === 'gobang') {
      const s = room.state;
      if (data.x === undefined || data.y === undefined) return;
      if (s.board[data.y][data.x] !== 0) return;
      s.board[data.y][data.x] = meIdx === 0 ? 1 : 2;
      s.movesCount++;
      s.lastMove = { x: data.x, y: data.y };
      if (checkGobang(s.board, data.x, data.y, meIdx === 0 ? 1 : 2)) {
        s.undo[meIdx]++;
        return checkGameEnd(room, meIdx, '五子连珠');
      }
      s.turn = 1 - s.turn;
      moved = true;
      emitGameState(room, true);
      maybeAITurn(room);
      return;
    } else if (g === 'xiangqi' || g === 'chess') {
      const s = room.state;
      if (data.fx === undefined || data.tx === undefined) return;
      const legal = g === 'xiangqi' ? xiangqiLegal : chessLegal;
      if (!legal(s.board, [data.fx, data.fy], [data.tx, data.ty], meIdx + 1)) return;
      s.board[data.ty][data.tx] = s.board[data.fy][data.fx];
      s.board[data.fy][data.fx] = 0;
      s.movesCount++;
      if (s.board[data.ty][data.tx] % 10 === 6) {
        return checkGameEnd(room, meIdx, g === 'xiangqi' ? '吃掉对方将帅' : '吃掉对方国王');
      }
      s.turn = 1 - s.turn;
      moved = true;
      emitGameState(room, true);
      maybeAITurn(room);
      return;
    } else if (g === 'go') {
      const s = room.state;
      if (data.x === undefined || data.y === undefined) return;
      if (s.board[data.y][data.x] !== 0) return;
      const color = meIdx === 0 ? 1 : 2;
      // 自杀检测
      const tmp = s.board[data.y][data.x];
      s.board[data.y][data.x] = color;
      if (!goSuicide(s.board, data.x, data.y, color) || goCapture(s.board, data.x, data.y, color) > 0) {
        // 合法
        s.passes = 0;
        s.board[data.y][data.x] = color;
        goCapture(s.board, data.x, data.y, color);
        s.movesCount++;
        s.turn = 1 - s.turn;
        moved = true;
        emitGameState(room, true);
        maybeAITurn(room);
        return;
      }
      s.board[data.y][data.x] = tmp;
      return;
    } else if (g === 'flying') {
      const s = room.state;
      if (data.roll) {
        if (s.dice !== 0) return;
        s.dice = flyDice();
        const p = s.players[meIdx];
        const movable = [0, 1, 2, 3].some(k => !p.finished[k] && (s.dice === 6 || p.pos[k] !== -1));
        if (movable) {
          // 自动选一架走
          const chosen = aiMoveFlying(s.players, meIdx, s.dice);
          if (chosen !== null) {
            const r = flyMovePlane(s.players, meIdx, chosen, s.dice);
            if (r.ok) {
              s.movesCount++;
              if (s.players[meIdx].finished.filter(Boolean).length === 4) {
                checkGameEnd(room, meIdx, '全部到达终点');
                return;
              }
              if (s.dice !== 6) s.turn = (s.turn + 1) % s.players.length;
              s.dice = 0;
            }
          }
        } else {
          s.turn = (s.turn + 1) % s.players.length;
          s.dice = 0;
        }
        emitGameState(room, true);
        maybeAITurn(room);
        return;
      } else if (data.plane !== undefined) {
        if (s.dice === 0) return;
        const p = s.players[meIdx];
        if (p.pos[data.plane] === -1 && s.dice !== 6) return;
        const r = flyMovePlane(s.players, meIdx, data.plane, s.dice);
        if (!r.ok) return;
        s.movesCount++;
        if (s.players[meIdx].finished.filter(Boolean).length === 4) {
          checkGameEnd(room, meIdx, '全部到达终点');
          return;
        }
        if (s.dice !== 6) s.turn = (s.turn + 1) % s.players.length;
        s.dice = 0;
        moved = true;
      }
    }

    if (moved) {
      emitGameState(room, true);
      maybeAITurn(room);
    }
  });

  // 悔棋(五子棋, 人机模式, 一局3次)
  socket.on('undo', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.gameOver || room.game !== 'gobang') return;
    if (!room.players.some(p => p.isAI)) return;
    const meIdx = room.players.findIndex(p => p.socket && p.socket.id === socket.id);
    if (meIdx === -1) return;
    if (room.state.undo[meIdx] >= 3) return;
    // 回退: 玩家最后一手 + AI最后一手
    const s = room.state;
    if (!s.lastMove) return;
    s.board[s.lastMove.y][s.lastMove.x] = 0;
    s.lastMove = null;
    s.undo[meIdx]++;
    s.turn = 0;
    if (s.movesCount > 0) s.movesCount--;
    emitGameState(room);
  });

  socket.on('disconnect', () => {
    // 清理匹配队列
    for (const [game, queue] of matchQueue) {
      const idx = queue.findIndex(q => q.socketId === socket.id);
      if (idx !== -1) queue.splice(idx, 1);
    }
    if (socket.data.user) {
      const uid = socket.data.user.id;
      if (userSockets.get(uid) === socket.id) {
        userSockets.delete(uid);
        onlineUsers.delete(uid);
        io.emit('onlineCount', onlineUsers.size);
      }
    }
    // 真人断线且对局未结束: 判负
    for (const room of rooms.values()) {
      if (room.gameOver) continue;
      const idx = room.players.findIndex(p => p.socket && p.socket.id === socket.id);
      if (idx !== -1) {
        const isAI = room.players.some(p => p.isAI);
        if (isAI) {
          // 人机模式下断线直接结束
          endGame(room, 1 - idx, '对方退出');
        } else {
          // 真人断线: 等待重连(不立即判负, 由对局页joinRoom重连; 这里只标记)
          // 简单处理: 断线即判负
          endGame(room, 1 - idx, '对方退出');
        }
      }
    }
  });
});

// 匹配
function tryMatch(game) {
  const queue = matchQueue.get(game);
  if (!queue || queue.length < 2) return;
  // 找两个不同用户
  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      const a = queue[i], b = queue[j];
      if (a.uid === b.uid) continue;
      queue.splice(j, 1);
      queue.splice(i, 1);
      const room = createRoom(game, [
        { uid: a.user.id, socket: a.socket, name: a.user.username, isAI: false, color: 0 },
        { uid: b.user.id, socket: b.socket, name: b.user.username, isAI: false, color: 1 }
      ]);
      a.socket.join(room.roomId);
      b.socket.join(room.roomId);
      a.socket.emit('gameStart', { roomId: room.roomId, game, color: 0, opponentName: b.user.username });
      b.socket.emit('gameStart', { roomId: room.roomId, game, color: 1, opponentName: a.user.username });
      setTimeout(() => emitGameState(room), 100);
      return;
    }
  }
}

server.listen(PORT, () => {
  console.log('棋类乐园服务器已启动: http://localhost:' + PORT);
  console.log('局域网访问: http://' + getLANIP() + ':' + PORT);
  console.log('管理后台: http://localhost:' + PORT + '/admin.html');
});

function getLANIP() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}
