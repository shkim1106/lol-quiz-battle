const { Redis } = require('@upstash/redis');
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const TTL = 7200;

async function getRoom(code)  { return redis.get(`room:${code}`); }
async function saveRoom(room) { await redis.set(`room:${room.code}`, room, { ex: TTL }); }

// Redis SETNX: 첫 번째 호출만 true → 중복 처리 방지
async function acquireLock(key, ttlSec = 12) {
  const result = await redis.set(key, '1', { nx: true, ex: ttlSec });
  return !!result;
}

// ── 원자적 점수 관련 ────────────────────────────────────────────────────────

// 답변 원자적 점유 (SETNX) — 이미 제출했으면 false 반환
// 중복 제출 방지 + race condition 방지를 단 하나의 원자 연산으로 처리
async function claimAnswer(code, qIdx, playerId, answerStr) {
  const key    = `aq:${code}:${qIdx}:${playerId}`;
  const result = await redis.set(key, String(answerStr), { nx: true, ex: TTL });
  return !!result;
}

// 점수 원자적 증가 (INCRBY) — 동시 요청이 와도 덮어쓰기 없음
async function addScore(code, playerId, delta) {
  const key = `sc:${code}:${playerId}`;
  await redis.incrby(key, delta);
  await redis.expire(key, TTL);
}

// 마지막 획득 점수 저장 (라운드 결과 화면 표시용)
async function setLastDelta(code, playerId, delta) {
  await redis.set(`ld:${code}:${playerId}`, delta, { ex: TTL });
}

// 이번 문제 제출 수 원자적 증가 (INCR) → 반환값이 플레이어 수와 같으면 전원 제출
async function incrementAnswerCount(code, qIdx) {
  const key   = `ac:${code}:${qIdx}`;
  const count = await redis.incr(key);
  await redis.expire(key, TTL);
  return count;
}

// 모든 플레이어 점수 + 마지막 델타 일괄 조회 (pipeline)
async function getPlayerScores(code, players) {
  if (!players.length) return [];
  const pipeline = redis.pipeline();
  for (const p of players) pipeline.get(`sc:${code}:${p.id}`);
  for (const p of players) pipeline.get(`ld:${code}:${p.id}`);
  const results = await pipeline.exec();
  const n = players.length;
  return players.map((p, i) => ({
    id:        p.id,
    nickname:  p.nickname,
    score:     Number(results[i])     || 0,
    lastDelta: Number(results[n + i]) || 0,
  }));
}

// 게임 시작/재시작 시 모든 플레이어 점수 초기화 (pipeline)
async function resetScores(code, players) {
  if (!players.length) return;
  const pipeline = redis.pipeline();
  for (const p of players) {
    pipeline.set(`sc:${code}:${p.id}`, 0, { ex: TTL });
    pipeline.set(`ld:${code}:${p.id}`, 0, { ex: TTL });
  }
  await pipeline.exec();
}

module.exports = {
  getRoom, saveRoom, acquireLock,
  claimAnswer, addScore, setLastDelta,
  incrementAnswerCount, getPlayerScores, resetScores,
};
