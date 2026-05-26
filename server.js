const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const fs   = require('fs');
const path = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── 데이터 로드 ────────────────────────────────────────────────────────────────
const champData = JSON.parse(fs.readFileSync('./data/champions.json', 'utf-8'));
const itemData  = JSON.parse(fs.readFileSync('./data/items_simple.json', 'utf-8'));

const champList  = Object.values(champData);
const champNames = champList.map(c => c.name);

const itemList = Object.entries(itemData)
  .map(([id, v]) => ({ id, ...v }))
  .filter(i => i.name && i.total_gold > 0);
const itemNames   = itemList.map(i => i.name);
const descItems   = itemList.filter(i => i.plaintext && i.plaintext.length > 5);
const recipeItems = itemList.filter(i => i.from  && i.from.length  >= 1);
const intoItems   = itemList.filter(i => i.into  && i.into.length  >= 1);

// ── 유틸리티 ───────────────────────────────────────────────────────────────────
const pick1  = arr => arr[Math.floor(Math.random() * arr.length)];
const pickN  = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);

function makeChoices(correct, pool) {
  const wrongs = shuffle(pool.filter(x => x !== correct)).slice(0, 3);
  return shuffle([correct, ...wrongs]);
}

// ── 퀴즈 생성기 (8가지 모드) ───────────────────────────────────────────────────
const generators = {

  // 1. 가격 계산
  price() {
    const [a, b, c] = pickN(itemList.filter(i => i.total_gold >= 300), 3);
    const r = Math.random();
    let question, answer;
    if (r < 0.34) {
      question = `<b>${a.name}</b> + <b>${b.name}</b> = ?G`;
      answer   = a.total_gold + b.total_gold;
    } else if (r < 0.67) {
      question = `<b>${a.name}</b> + <b>${b.name}</b> − <b>${c.name}</b> = ?G`;
      answer   = a.total_gold + b.total_gold - c.total_gold;
    } else {
      question = `<b>${a.name}</b> × 2 − <b>${b.name}</b> = ?G`;
      answer   = a.total_gold * 2 - b.total_gold;
    }
    return {
      type: 'input', label: '💰 가격 계산',
      hint: `${a.name} ${a.total_gold}G · ${b.name} ${b.total_gold}G · ${c.name} ${c.total_gold}G`,
      question, answer, tolerance: 0.08,
    };
  },

  // 2. 아이템 설명 맞추기
  description() {
    const item = pick1(descItems);
    return {
      type: 'choice', label: '🔍 아이템 설명 맞추기',
      question: `다음 설명의 아이템은?<br><br><em>"${item.plaintext}"</em>`,
      options: makeChoices(item.name, itemNames),
      answer: item.name,
    };
  },

  // 3. 재료 아이템 맞추기
  recipe() {
    const item    = pick1(recipeItems);
    const correct = pick1(item.from);
    return {
      type: 'choice', label: '📦 재료 아이템 맞추기',
      question: `<b>${item.name}</b> (${item.total_gold}G)<br><br>이 아이템의 <u>재료</u>로 사용되는 아이템은?`,
      options: makeChoices(correct, itemNames),
      answer: correct,
    };
  },

  // 4. 상위 아이템 맞추기
  into() {
    const item    = pick1(intoItems);
    const correct = pick1(item.into);
    return {
      type: 'choice', label: '⬆️ 상위 아이템 맞추기',
      question: `<b>${item.name}</b> (${item.total_gold}G)<br><br>이 아이템으로 조합할 수 있는 <u>상위 아이템</u>은?`,
      options: makeChoices(correct, itemNames),
      answer: correct,
    };
  },

  // 5. 스킬 이름으로 챔피언 맞추기
  skill() {
    const champ  = pick1(champList);
    const spells = Object.values(champ.spells);
    return {
      type: 'choice', label: '⚡ 스킬로 챔피언 맞추기',
      question:
        `다음 스킬을 가진 챔피언은?<br><br>` +
        `패시브: <b>${champ.passive.name}</b><br>` +
        `Q: <b>${spells[0].name}</b><br>` +
        `W: <b>${spells[1].name}</b>`,
      options: makeChoices(champ.name, champNames),
      answer: champ.name,
    };
  },

  // 6. 로어로 챔피언 맞추기
  lore() {
    const champ   = pick1(champList.filter(c => c.lore?.length > 50));
    const snippet = champ.lore.slice(0, 110) + '…';
    return {
      type: 'choice', label: '📖 로어로 챔피언 맞추기',
      question: `다음 배경 스토리의 챔피언은?<br><br><em>"${snippet}"</em>`,
      options: makeChoices(champ.name, champNames),
      answer: champ.name,
    };
  },

  // 7. 팁으로 챔피언 맞추기
  tip() {
    const champ = pick1(champList.filter(c => c.allytips?.length > 0));
    const tip   = pick1(champ.allytips);
    return {
      type: 'choice', label: '💡 아군 팁으로 챔피언 맞추기',
      question: `다음 아군 팁은 어떤 챔피언에 대한 설명인가요?<br><br><em>"${tip}"</em>`,
      options: makeChoices(champ.name, champNames),
      answer: champ.name,
    };
  },

  // 8. 칭호로 챔피언 맞추기
  title() {
    const champ = pick1(champList.filter(c => c.title));
    return {
      type: 'choice', label: '🏷️ 칭호로 챔피언 맞추기',
      question: `다음 칭호를 가진 챔피언은?<br><br><em>"${champ.title}"</em>`,
      options: makeChoices(champ.name, champNames),
      answer: champ.name,
    };
  },
};

const MODES = [
  { id: 'price',       label: '💰 가격 계산' },
  { id: 'description', label: '🔍 아이템 설명 맞추기' },
  { id: 'recipe',      label: '📦 재료 아이템 맞추기' },
  { id: 'into',        label: '⬆️ 상위 아이템 맞추기' },
  { id: 'skill',       label: '⚡ 스킬로 챔피언 맞추기' },
  { id: 'lore',        label: '📖 로어로 챔피언 맞추기' },
  { id: 'tip',         label: '💡 아군 팁으로 챔피언 맞추기' },
  { id: 'title',       label: '🏷️ 칭호로 챔피언 맞추기' },
];

// ── 룸 관리 ────────────────────────────────────────────────────────────────────
const rooms = {};

function genCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => ch[Math.floor(Math.random() * ch.length)]).join('');
}

function getPlayers(code) {
  return Object.values(rooms[code]?.players ?? {});
}

// ── 게임 진행 ──────────────────────────────────────────────────────────────────
const TIME_LIMIT     = 20;   // 문제당 초
const TOTAL_Q        = 10;   // 라운드 수
const RESULT_DELAY   = 4500; // 결과 표시 후 다음 문제까지 ms

function nextQuestion(code) {
  const room = rooms[code];
  if (!room) return;

  room.qIdx++;
  if (room.qIdx > TOTAL_Q) { endGame(code); return; }

  const modeId = pick1(room.settings.modes);
  const quiz   = generators[modeId]();
  room.quiz      = quiz;
  room.answers   = {};
  room.startTime = Date.now();

  io.to(code).emit('question', { quiz, qIdx: room.qIdx, total: TOTAL_Q, timeLimit: TIME_LIMIT });

  clearTimeout(room.timer);
  room.timer = setTimeout(() => showResult(code), TIME_LIMIT * 1000 + 600);
}

function showResult(code) {
  const room = rooms[code];
  if (!room || !room.quiz) return;
  clearTimeout(room.timer);

  const ranking = getPlayers(code)
    .map(p => ({ nickname: p.nickname, score: p.score, delta: p.lastDelta }))
    .sort((a, b) => b.score - a.score);

  io.to(code).emit('round_end', { answer: room.quiz.answer, ranking });
  room.timer = setTimeout(() => nextQuestion(code), RESULT_DELAY);
}

function endGame(code) {
  const room = rooms[code];
  if (!room) return;
  clearTimeout(room.timer);
  room.status = 'ended';

  const ranking = getPlayers(code)
    .map(p => ({ nickname: p.nickname, score: p.score }))
    .sort((a, b) => b.score - a.score);

  io.to(code).emit('game_end', { ranking });
}

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  socket.on('create_room', ({ nickname }) => {
    const code = genCode();
    rooms[code] = {
      code, host: socket.id, status: 'waiting',
      players: { [socket.id]: { id: socket.id, nickname, score: 0, lastDelta: 0 } },
      quiz: null, answers: {}, qIdx: 0, timer: null,
      settings: { modes: MODES.map(m => m.id) },
    };
    socket.join(code);
    socket.data.code = code;
    socket.emit('room_ready', { code, isHost: true, players: getPlayers(code), modes: MODES, selectedModes: MODES.map(m => m.id) });
    console.log(`[방 생성] ${code}  방장: ${nickname}`);
  });

  socket.on('join_room', ({ code, nickname }) => {
    const room = rooms[code];
    if (!room)                               return socket.emit('error', '존재하지 않는 방 코드입니다.');
    if (room.status !== 'waiting')           return socket.emit('error', '이미 시작된 게임입니다.');
    if (Object.keys(room.players).length >= 30) return socket.emit('error', '방이 가득 찼습니다 (최대 30명).');

    room.players[socket.id] = { id: socket.id, nickname, score: 0, lastDelta: 0 };
    socket.join(code);
    socket.data.code = code;
    socket.emit('room_ready', { code, isHost: false, players: getPlayers(code), modes: MODES, selectedModes: room.settings.modes });
    io.to(code).emit('player_update', getPlayers(code));
    console.log(`[입장] ${nickname}  →  ${code}`);
  });

  socket.on('update_settings', ({ modes }) => {
    const room = rooms[socket.data.code];
    if (!room || room.host !== socket.id || !modes?.length) return;
    room.settings.modes = modes;
  });

  socket.on('start_game', () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room || room.host !== socket.id || room.status !== 'waiting') return;

    room.status = 'playing';
    room.qIdx   = 0;
    Object.values(room.players).forEach(p => { p.score = 0; p.lastDelta = 0; });

    io.to(code).emit('game_started');
    setTimeout(() => nextQuestion(code), 1200);
  });

  socket.on('submit_answer', ({ answer }) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room || room.status !== 'playing' || !room.quiz) return;
    if (room.answers[socket.id] !== undefined) return; // 중복 제출 방지

    const elapsed = (Date.now() - room.startTime) / 1000;
    const { quiz } = room;
    let correct = false;

    if (quiz.type === 'input') {
      const num = Number(answer);
      correct   = !isNaN(num) && Math.abs(num - quiz.answer) <= quiz.answer * quiz.tolerance;
    } else {
      correct = answer === quiz.answer;
    }

    const delta = correct ? Math.max(50, Math.round(100 * (1 - elapsed / TIME_LIMIT))) : 0;

    room.answers[socket.id]          = answer;
    room.players[socket.id].score    += delta;
    room.players[socket.id].lastDelta = delta;

    socket.emit('answer_result', { correct, delta });

    // 전원 제출 시 즉시 결과 공개
    if (Object.keys(room.answers).length >= Object.keys(room.players).length) {
      clearTimeout(room.timer);
      showResult(code);
    }
  });

  socket.on('restart_game', () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.status = 'waiting';
    room.qIdx   = 0;
    Object.values(room.players).forEach(p => { p.score = 0; p.lastDelta = 0; });
    io.to(code).emit('game_reset', { players: getPlayers(code) });
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room) return;

    const name = room.players[socket.id]?.nickname ?? '?';
    delete room.players[socket.id];
    const remaining = Object.keys(room.players);
    console.log(`[퇴장] ${name}  ←  ${code}`);

    if (!remaining.length) { clearTimeout(room.timer); delete rooms[code]; return; }
    if (room.host === socket.id) room.host = remaining[0];
    io.to(code).emit('player_update', getPlayers(code));
  });
});

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => console.log(`🎮  LoL 퀴즈 배틀 → http://localhost:${PORT}`));
