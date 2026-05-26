const express = require('express');
const pusher  = require('../lib/pusher');
const { getRoom, saveRoom, acquireLock } = require('../lib/redis');
const { generators, MODES, sanitize } = require('../lib/quiz');

const app = express();
app.use(express.json());

const TIME_LIMIT   = 20;
const TOTAL_Q      = 10;
const MAX_PLAYERS  = 30;
const ROOM_TTL_MSG = '방이 만료되었거나 존재하지 않습니다.';

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function genCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => ch[Math.floor(Math.random() * ch.length)]).join('');
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function pick1(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function channel(code) { return `room-${code}`; }

function trigger(code, event, data) {
  return pusher.trigger(channel(code), event, data);
}

// ── Pusher 공개 설정 ──────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    key:     process.env.PUSHER_KEY,
    cluster: process.env.PUSHER_CLUSTER || 'ap3',
  });
});

// ── 방 만들기 ─────────────────────────────────────────────────────────────────
app.post('/api/room/create', async (req, res) => {
  const { nickname } = req.body;
  if (!nickname) return res.status(400).json({ error: '닉네임이 필요합니다.' });

  const code     = genCode();
  const playerId = genId();
  const player   = { id: playerId, nickname, score: 0, lastDelta: 0 };
  const room = {
    code,
    hostId:    playerId,
    status:    'waiting',
    players:   [player],
    settings:  { modes: MODES.map(m => m.id) },
    qIdx:      0,
    quiz:      null,
    answers:   {},
    startTime: 0,
  };

  await saveRoom(room);
  res.json({ code, playerId, players: room.players, modes: MODES, selectedModes: room.settings.modes });
});

// ── 방 참가 ───────────────────────────────────────────────────────────────────
app.post('/api/room/join', async (req, res) => {
  const { code, nickname } = req.body;
  const room = await getRoom(code);
  if (!room)                         return res.status(404).json({ error: ROOM_TTL_MSG });
  if (room.status !== 'waiting')     return res.status(400).json({ error: '이미 시작된 게임입니다.' });
  if (room.players.length >= MAX_PLAYERS)
                                     return res.status(400).json({ error: `방이 가득 찼습니다 (최대 ${MAX_PLAYERS}명).` });

  const playerId = genId();
  const player   = { id: playerId, nickname, score: 0, lastDelta: 0 };
  room.players.push(player);
  await saveRoom(room);

  await trigger(code, 'player_update', { players: room.players });
  res.json({ code, playerId, players: room.players, modes: MODES, selectedModes: room.settings.modes });
});

// ── 모드 설정 ─────────────────────────────────────────────────────────────────
app.post('/api/room/settings', async (req, res) => {
  const { code, playerId, modes } = req.body;
  const room = await getRoom(code);
  if (!room || room.hostId !== playerId) return res.status(403).json({ error: '권한 없음' });
  if (!modes?.length)                    return res.status(400).json({ error: '모드를 1개 이상 선택하세요.' });

  room.settings.modes = modes;
  await saveRoom(room);
  res.json({ ok: true });
});

// ── 게임 시작 ─────────────────────────────────────────────────────────────────
app.post('/api/game/start', async (req, res) => {
  const { code, playerId } = req.body;
  const room = await getRoom(code);
  if (!room)                         return res.status(404).json({ error: ROOM_TTL_MSG });
  if (room.hostId !== playerId)      return res.status(403).json({ error: '방장만 시작할 수 있습니다.' });
  if (room.status !== 'waiting')     return res.status(400).json({ error: '이미 시작된 게임입니다.' });

  room.status = 'playing';
  room.qIdx   = 0;
  room.players.forEach(p => { p.score = 0; p.lastDelta = 0; });

  await saveRoom(room);

  // game_started → 첫 문제를 순서대로 트리거 (setTimeout은 서버리스에서 동작 안 함)
  await trigger(code, 'game_started', {});
  await sendNextQuestion(code);

  res.json({ ok: true });
});

// ── 정답 제출 ─────────────────────────────────────────────────────────────────
app.post('/api/game/submit', async (req, res) => {
  const { code, playerId, answer } = req.body;
  const room = await getRoom(code);
  if (!room || room.status !== 'playing' || !room.quiz)
    return res.status(400).json({ error: '진행 중인 게임이 없습니다.' });

  if (room.answers[playerId] !== undefined)
    return res.json({ correct: false, delta: 0, alreadyAnswered: true });

  const elapsed = (Date.now() - room.startTime) / 1000;
  const { quiz } = room;
  let correct = false;

  if (quiz.type === 'input') {
    const num = Number(answer);
    correct   = !isNaN(num) && Math.abs(num - quiz.answer) <= quiz.answer * quiz.tolerance;
  } else {
    correct = String(answer) === String(quiz.answer);
  }

  const delta = correct ? Math.max(50, Math.round(100 * (1 - elapsed / TIME_LIMIT))) : 0;
  room.answers[playerId] = answer;

  const p = room.players.find(p => p.id === playerId);
  if (p) { p.score += delta; p.lastDelta = delta; }

  await saveRoom(room);

  // 전원 제출 시 즉시 라운드 종료
  if (Object.keys(room.answers).length >= room.players.length) {
    await sendRoundEnd(code, room);
  }

  res.json({ correct, delta });
});

// ── 타임아웃 (클라이언트 타이머 만료 시 호출) ───────────────────────────────
app.post('/api/game/timeout', async (req, res) => {
  const { code, qIdx } = req.body;
  const room = await getRoom(code);
  if (!room || room.qIdx !== Number(qIdx)) return res.json({ ok: false });

  // 락: 여러 클라이언트가 동시에 호출해도 한 번만 처리
  const locked = await acquireLock(`lock:${code}:timeout:${qIdx}`);
  if (!locked) return res.json({ ok: false, duplicate: true });

  const freshRoom = await getRoom(code); // 락 이후 최신 상태
  if (freshRoom && freshRoom.status === 'playing') {
    await sendRoundEnd(code, freshRoom);
  }

  res.json({ ok: true });
});

// ── 다음 문제 (라운드 결과 표시 후 클라이언트가 호출) ──────────────────────
app.post('/api/game/next', async (req, res) => {
  const { code, qIdx } = req.body;
  const room = await getRoom(code);
  if (!room || room.qIdx !== Number(qIdx)) return res.json({ ok: false });

  const locked = await acquireLock(`lock:${code}:next:${qIdx}`);
  if (!locked) return res.json({ ok: false, duplicate: true });

  await sendNextQuestion(code);
  res.json({ ok: true });
});

// ── 게임 재시작 ───────────────────────────────────────────────────────────────
app.post('/api/game/restart', async (req, res) => {
  const { code, playerId } = req.body;
  const room = await getRoom(code);
  if (!room || room.hostId !== playerId) return res.status(403).json({ error: '권한 없음' });

  room.status  = 'waiting';
  room.qIdx    = 0;
  room.quiz    = null;
  room.answers = {};
  room.players.forEach(p => { p.score = 0; p.lastDelta = 0; });

  await saveRoom(room);
  await trigger(code, 'game_reset', { players: room.players });
  res.json({ ok: true });
});

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

async function sendNextQuestion(code) {
  const room = await getRoom(code);
  if (!room || room.status !== 'playing') return;

  room.qIdx++;

  if (room.qIdx > TOTAL_Q) {
    room.status = 'ended';
    await saveRoom(room);
    const ranking = [...room.players].sort((a, b) => b.score - a.score)
      .map(p => ({ nickname: p.nickname, score: p.score }));
    await trigger(code, 'game_end', { ranking });
    return;
  }

  const modeId = pick1(room.settings.modes);
  const quiz   = generators[modeId]();
  room.quiz      = quiz;
  room.answers   = {};
  room.startTime = Date.now();

  await saveRoom(room);

  await trigger(code, 'question', {
    quiz:      sanitize(quiz),   // answer 제외하고 전송
    qIdx:      room.qIdx,
    total:     TOTAL_Q,
    timeLimit: TIME_LIMIT,
  });
}

async function sendRoundEnd(code, room) {
  const ranking = [...room.players]
    .sort((a, b) => b.score - a.score)
    .map(p => ({ nickname: p.nickname, score: p.score, delta: p.lastDelta }));

  await trigger(code, 'round_end', {
    answer:  room.quiz.type === 'input'
               ? `${room.quiz.answer}G`
               : room.quiz.answer,
    ranking,
  });
}

module.exports = app;
