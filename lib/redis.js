const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ROOM_TTL = 7200; // 2시간

async function getRoom(code) {
  return redis.get(`room:${code}`);
}

async function saveRoom(room) {
  await redis.set(`room:${room.code}`, room, { ex: ROOM_TTL });
}

// Redis SETNX: 첫 번째 호출만 true 반환 → 중복 처리 방지
async function acquireLock(key, ttlSec = 12) {
  const result = await redis.set(key, '1', { nx: true, ex: ttlSec });
  return !!result;
}

module.exports = { getRoom, saveRoom, acquireLock };
