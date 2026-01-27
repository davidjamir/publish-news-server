const { redis } = require("./redis");
const { toStr } = require("../helper/toString");

// CONFIG

// gap tối thiểu giữa 2 post của cùng 1 page (ms)
const DEFAULT_GAP_MS = 120 * 60 * 1000; // 120 phút

// random jitter để tránh pattern cứng (ms)
const DEFAULT_JITTER_MS = 3 * 60 * 1000; // ±3 phút

// giờ vàng Mỹ (local hour)
const US_PRIME_HOURS = [
  [7, 10], // morning
  [11, 13], // lunch
  [16, 23], // evening
];

// timezone Mỹ (tạm dùng Eastern)
const US_TIMEZONE = "America/New_York";

const LAST_SCHEDULED_PREFIX = "page:lastScheduled";

// HELPERS

function getLastScheduledKey(pageId) {
  pageId = toStr(pageId);
  if (!pageId) throw new Error("pageId is required");
  return `${LAST_SCHEDULED_PREFIX}:${pageId}`;
}

function randBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function withJitter(baseMs, jitterMs) {
  if (!jitterMs) return baseMs;
  return baseMs + randBetween(-jitterMs, jitterMs);
}

function getLocalHour(ts, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));

  return Number(parts.find((p) => p.type === "hour")?.value);
}

function isInPrimeHour(ts) {
  const h = getLocalHour(ts, US_TIMEZONE);
  return US_PRIME_HOURS.some(([a, b]) => h >= a && h <= b);
}

function randomMinutes(min = 0, max = 30) {
  return Math.floor(Math.random() * (max - min + 1) + min) * 60 * 1000;
}
/**
 * =========================
 * REDIS STATE
 * =========================
 */

async function getLastScheduledAt(pageId) {
  const raw = await redis.get(getLastScheduledKey(pageId));
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function setLastScheduledAt(pageId, tsMs) {
  tsMs = Number(tsMs);
  if (!Number.isFinite(tsMs) || tsMs <= 0)
    throw new Error("setLastScheduledAt: invalid timestamp");

  await redis.set(getLastScheduledKey(pageId), String(tsMs));
  return { ok: true };
}

/**
 * =========================
 * CORE SCHEDULER
 * =========================
 */

/**
 * Tính scheduleAt cho 1 page
 *
 * - không quan tâm publish
 * - chỉ dựa vào lastScheduledAt
 */
async function computeScheduleAt({
  pageId,
  nowMs = Date.now(),
  gapMs = DEFAULT_GAP_MS,
  jitterMs = DEFAULT_JITTER_MS,
}) {
  if (!pageId) throw new Error("computeScheduleAt: pageId is required");

  const last = await getLastScheduledAt(pageId);

  // base timeline
  let base = Math.max(nowMs, last || 0) + gapMs + randomMinutes();

  // nếu rơi ngoài giờ vàng → đẩy tới giờ vàng tiếp theo
  if (!isInPrimeHour(base)) {
    base = moveToNextPrimeHour(base);
  }

  // thêm random jitter
  const scheduledAt = withJitter(base, jitterMs);

  return scheduledAt;
}

/**
 * Đẩy timestamp tới giờ vàng Mỹ tiếp theo
 */
function moveToNextPrimeHour(ts) {
  const d = new Date(ts);

  for (let i = 0; i < 48; i++) {
    const hour = getLocalHour(d.getTime(), US_TIMEZONE);
    if (US_PRIME_HOURS.some(([a, b]) => hour >= a && hour <= b)) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 30);
  }

  // fallback
  return ts;
}

/**
 * =========================
 * HIGH-LEVEL API
 * =========================
 */

/**
 * Compute + persist lastScheduledAt
 * → gọi NGAY sau khi scheduleOne thành công
 */
async function commitScheduleForPage(pageId, scheduleAtMs) {
  await setLastScheduledAt(pageId, scheduleAtMs);
  return { ok: true, pageId, scheduleAt: scheduleAtMs };
}

module.exports = {
  // redis state
  getLastScheduledAt,
  setLastScheduledAt,

  // compute
  computeScheduleAt,

  // commit
  commitScheduleForPage,

  // config (export để debug/tuning)
  DEFAULT_GAP_MS,
  DEFAULT_JITTER_MS,
};
