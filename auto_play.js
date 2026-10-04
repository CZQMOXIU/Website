// 通用自动对弈脚本（支持全部5种棋自动匹配）: node auto_play.js 用户名 密码
const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000';
const username = process.argv[2];
const password = process.argv[3];
if (!username || !password) {
  console.error('用法: node auto_play.js 用户名 密码');
  process.exit(1);
}

const GAMES = ['gobang', 'xiangqi', 'chess', 'go', 'flying'];
const GAME_CN = { gobang: '五子棋', xiangqi: '中国象棋', chess: '国际象棋', go: '围棋', flying: '飞行棋' };

// ================= 五子棋走法 =================
function gobangMove(board, myColor) {
  let has = false;
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++)
      if (board[y][x] !== 0) { has = true; break; }
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
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2; dx++) {
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

// ================= 象棋/国象候选走法生成 =================
function xiangqiCands(board, color) {
  const cands = [];
  const mine = v => (color === 1 ? v >= 1 && v <= 7 : v >= 11 && v <= 17);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const v = board[y][x];
    if (!mine(v)) continue;
    const kind = v % 10;
    let targets = [];
    if (kind === 1) targets = dirs.map(([dx,dy]) => [x+dx, y+dy]);
    else if (kind === 2) targets = [[x+1,y+1],[x-1,y+1],[x+1,y-1],[x-1,y-1]];
    else if (kind === 3) targets = [[x+2,y+2],[x-2,y+2],[x+2,y-2],[x-2,y-2]];
    else if (kind === 4) targets = [[x+1,y+2],[x-1,y+2],[x+2,y+1],[x-2,y+1],[x+1,y-2],[x-1,y-2],[x+2,y-1],[x-2,y-1]];
    else if (kind === 5 || kind === 6) {
      for (const [dx,dy] of dirs) for (let i = 1; i <= 9; i++) targets.push([x+dx*i, y+dy*i]);
    }
    else if (kind === 7) {
      const f = color === 1 ? -1 : 1;
      targets.push([x, y+f]);
      if (color === 1 ? y < 5 : y > 4) { targets.push([x+1, y]); targets.push([x-1, y]); }
    }
    for (const [tx, ty] of targets) {
      if (tx >= 0 && tx < 9 && ty >= 0 && ty < 10) {
        const t = board[ty][tx];
        if (mine(t)) continue;
        cands.push({ fx: x, fy: y, tx, ty });
      }
    }
  }
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  return cands;
}

function chessCands(board, color) {
  const cands = [];
  const mine = v => (color === 1 ? v >= 1 && v <= 6 : v >= 11 && v <= 16);
  const kingDirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const knightDirs = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
  const lineDirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const diagDirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = board[y][x];
    if (!mine(v)) continue;
    const kind = v % 10;
    let targets = [];
    if (kind === 1) targets = kingDirs.map(([dx,dy]) => [x+dx, y+dy]);
    else if (kind === 2) targets = lineDirs.flatMap(([dx,dy]) => Array.from({length:7},(_,i)=>[x+dx*(i+1), y+dy*(i+1)]));
    else if (kind === 3) targets = [[1,0],[-1,0],[0,1],[0,-1]].flatMap(([dx,dy]) => Array.from({length:7},(_,i)=>[x+dx*(i+1), y+dy*(i+1)]));
    else if (kind === 4) targets = diagDirs.flatMap(([dx,dy]) => Array.from({length:7},(_,i)=>[x+dx*(i+1), y+dy*(i+1)]));
    else if (kind === 5) targets = knightDirs.map(([dx,dy]) => [x+dx, y+dy]);
    else if (kind === 6) {
      const f = color === 1 ? -1 : 1;
      targets.push([x, y+f]);
      if (y === (color === 1 ? 6 : 1)) targets.push([x, y+f*2]);
      targets.push([x+1, y+f]); targets.push([x-1, y+f]);
    }
    for (const [tx, ty] of targets) {
      if (tx >= 0 && tx < 8 && ty >= 0 && ty < 8) {
        const t = board[ty][tx];
        if (mine(t)) continue;
        cands.push({ fx: x, fy: y, tx, ty });
      }
    }
  }
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  return cands;
}

// ================= 围棋走法 =================
function goMove(board) {
  const N = board.length;
  let best = null, bestScore = -Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (board[y][x] !== 0) continue;
    let near = 0;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x+dx, ny = y+dy;
      if (nx >= 0 && nx < N && ny >= 0 && ny < N && board[ny][nx] !== 0) near++;
    }
    const s = near * 10 + Math.random() * 3;
    if (s > bestScore) { bestScore = s; best = { x, y }; }
  }
  return best || { x: Math.floor(N/2), y: Math.floor(N/2) };
}

// ================= Bot =================
function startBot(game) {
  const socket = io(BASE);
  let roomId = null;
  let myColor = 0;
  let cands = [];
  let candIdx = 0;
  let candTimer = null;
  let lastStateKey = '';
  let inGame = false;

  const cn = GAME_CN[game];

  function emitMatch() {
    socket.emit('matchmake', { game, user });
    log('加入[' + cn + ']匹配队列');
  }

  function clearCand() {
    if (candTimer) { clearTimeout(candTimer); candTimer = null; }
    cands = [];
    candIdx = 0;
  }

  function tryNextCand(socket, d) {
    if (candIdx >= cands.length) {
      clearCand();
      return;
    }
    const c = cands[candIdx++];
    socket.emit('place', { roomId: d.roomId, ...c });
    if (candTimer) clearTimeout(candTimer);
    candTimer = setTimeout(() => {
      candTimer = null;
      tryNextCand(socket, d);
    }, 1000);
  }

  socket.on('connect', () => {
    socket.emit('loginSocket', user);
    setTimeout(emitMatch, 400);
  });

  socket.on('waiting', () => {
    log('[' + cn + ']等待对手…');
  });

  socket.on('gameStart', d => {
    roomId = d.roomId;
    myColor = d.color;
    inGame = true;
    clearCand();
    log('[' + cn + ']🎮 配对成功！执' + (d.color === 0 ? '先' : '后') + '，对手:' + d.opponentName);
  });

  socket.on('gameState', d => {
    if (!inGame || d.roomId !== roomId) return;
    const key = JSON.stringify(d.state).slice(0, 200) + d.turn;
    if (key === lastStateKey) return;
    lastStateKey = key;

    if (d.turn !== myColor || d.gameOver) return;
    const s = d.state;

    if (game === 'gobang') {
      const pos = gobangMove(s.board, myColor === 0 ? 1 : 2);
      socket.emit('place', { roomId, x: pos.x, y: pos.y });
    } else if (game === 'xiangqi') {
      cands = xiangqiCands(s.board, myColor + 1);
      candIdx = 0;
      tryNextCand(socket, d);
    } else if (game === 'chess') {
      cands = chessCands(s.board, myColor + 1);
      candIdx = 0;
      tryNextCand(socket, d);
    } else if (game === 'go') {
      const pos = goMove(s.board);
      socket.emit('place', { roomId, x: pos.x, y: pos.y });
    } else if (game === 'flying') {
      if (!s.dice) socket.emit('place', { roomId, roll: true });
    }
  });

  socket.on('gameOver', d => {
    clearCand();
    inGame = false;
    log('[' + cn + ']对局结束: ' + (d.winnerName || '平局'));
    roomId = null;
    setTimeout(emitMatch, 1500);
  });

  socket.on('disconnect', () => {
    clearCand();
    inGame = false;
    log('[' + cn + ']连接断开，尝试重连…');
    setTimeout(() => { if (!socket.connected) socket.connect(); }, 2000);
  });
}

function log(msg) {
  console.log('[' + username + '] ' + msg);
}

// 登录
async function main() {
  const loginRes = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: Buffer.from(password).toString('base64') })
  });
  const loginData = await loginRes.json();
  if (loginData.code !== 0) {
    console.error('[' + username + '] 登录失败:', loginData.msg);
    process.exit(1);
  }
  global.user = loginData.data;
  log('已登录，为全部5种棋启动自动匹配');
  GAMES.forEach(g => startBot(g));
}

main().catch(e => console.error(e));
