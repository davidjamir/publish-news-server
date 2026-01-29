const { redis } = require("./redis");
const { safeParse } = require("../helper/safeParse");
const { isoTimeZone } = require("../helper/timeZone");
const { newsStore, socialStore } = require("../src/store");
const { toStr } = require("../helper/toString");

const DEDUPE_TTL_SECONDS = 10 * 24 * 60 * 60;
const NEWS_PREFIX = "news";
const NEWS_QUEUE = "news:queue";
const NEWS_DEDUPE = "news:dedupe";
const SOCIAL_PREFIX = "social";
const SOCIAL_QUEUE = "social:queue";
const SOCIAL_DEDUPE = "social:dedupe";
const SOCIAL_SCHEDULE = "social:schedule";

const CRAWL_PREFIX = "crawl";
const CRAWL_QUEUE = "crawl:queue";
const CRAWL_DEDUPE = "crawl:dedupe";

function makeQueue({
  prefix, // "news" | "social"
  queueKey, // default: `${prefix}:queue`
  scheduleKey, //`${prefix}:schedule` (ZSET)
  dedupePrefix, // default: `${prefix}:dedupe`
  modeEnv, // "NEWS_QUEUE_MODE" | "SOCIAL_QUEUE_MODE"
  defaultMode = "auto", // "auto" | "manual"
  dedupeTtlSeconds = 10 * 24 * 60 * 60,
  maxQueueLen = 100000,
  onqueued,
  statusIdFromId,
} = {}) {
  const queue = toStr(queueKey);
  const dedupe = toStr(dedupePrefix);
  const modeenv = toStr(modeEnv);
  const prefixName = toStr(prefix) || "queue";

  if (!queue) throw new Error("queueKey is required");
  if (!dedupe) throw new Error("dedupePrefix is required");
  if (!modeenv) throw new Error("modeEnv is required");

  const mode = toStr(process.env[modeenv] || defaultMode).toLowerCase();

  function getStatusId(id) {
    return typeof statusIdFromId === "function" ? statusIdFromId(id) : id;
  }

  function isAutoMode() {
    return mode === "auto";
  }

  function buildDedupeKey(id) {
    const s = toStr(id);
    if (!s) throw new Error(`id is required`);
    return `${dedupe}:${s}`;
  }

  async function pushOne(
    id,
    { dedupe: usededupe = true, status = "queued" } = {},
  ) {
    const itemId = toStr(id);
    if (!itemId) throw new Error(`itemId is required`);

    if (usededupe) {
      const ok = await redis.set(buildDedupeKey(itemId), "1", {
        nx: true,
        ex: dedupeTtlSeconds,
      });
      if (!ok) {
        return {
          ok: true,
          skipped: true,
          reason: "deduped",
          itemId,
        };
      }
    }

    await redis.lpush(queue, JSON.stringify(itemId));
    await redis.ltrim(queue, 0, Math.max(maxQueueLen - 1, 0));

    // update status sau khi enqueue thành công
    if (typeof onqueued === "function") {
      await onqueued(getStatusId(itemId), status, {
        queuedAt: new Date().toISOString(),
      });
    }
    return { ok: true, skipped: false, id: itemId };
  }

  async function pushFromBatch(payload, { dedupe: usededupe = true } = {}) {
    const batchId = toStr(payload?.batchId);
    const index = Array.isArray(payload?.index) ? payload.index : [];

    if (!batchId) throw new Error("payload.batchId is required");
    if (!index.length) return { ok: true, queued: 0, skipped: 0, batchId };

    let queued = 0;
    let skipped = 0;

    for (const it of index) {
      const itemId = toStr(it);
      if (!itemId) continue;

      const r = await pushOne(itemId, { dedupe: usededupe });
      if (r.skipped) skipped++;
      else queued++;
    }

    return { ok: true, queued, skipped, batchId };
  }

  async function maybeEnqueueFromBatch(payload, opts = {}) {
    if (!isAutoMode()) {
      return { ok: true, mode, enqueued: false };
    }
    const r = await pushFromBatch(payload, opts);
    return { ok: true, mode, enqueued: true, ...r };
  }

  async function view(limit = 10) {
    const n = Math.min(Math.max(Number(limit || 10), 1), 50);
    const raws = await redis.lrange(queue, 0, n - 1);
    return (raws || []).map(safeParse).filter(Boolean);
  }

  async function pop() {
    const raw = await redis.rpop(queue);
    return safeParse(raw);
  }

  async function del(id) {
    const s = toStr(id);
    if (!s) throw new Error("id is required");
    const removed = await redis.lrem(queue, 0, JSON.stringify(s));
    return { ok: true, id: s, removed: Number(removed || 0) };
  }

  async function size() {
    return await redis.llen(queue);
  }

  async function clear() {
    await redis.del(queue);
    return { ok: true };
  }

  async function deleteDedupe(id) {
    const s = toStr(id);
    if (!s) throw new Error(`id is required`);
    await redis.del(buildDedupeKey(s));
    return { ok: true };
  }

  async function scheduleOne(
    id,
    scheduleAtMs,
    { dedupe: usededupe = true } = {},
  ) {
    const member = toStr(id);
    if (!member) throw new Error(`id is required`);
    const at = Number(scheduleAtMs || 0);
    if (!Number.isFinite(at) || at <= 0)
      throw new Error("scheduleAtMs must be a positive number");
    if (!scheduleKey) throw new Error("scheduleKey is not configured");

    if (usededupe) {
      const ok = await redis.set(buildDedupeKey(member), "1", {
        nx: true,
        ex: dedupeTtlSeconds,
      });
      if (!ok) {
        return { ok: true, skipped: true, reason: "deduped", id: member };
      }
    }

    // ZADD schedule
    await redis.zadd(scheduleKey, {
      score: at,
      member,
    });

    if (typeof onqueued === "function") {
      await onqueued(getStatusId(member), "scheduled", {
        scheduledAt: new Date().toISOString(),
        scheduleAt: at,
      });
    }

    return { ok: true, skipped: false, id: member, scheduleAt: at };
  }

  async function moveDueToQueue(limit = 50) {
    const n = Math.min(Math.max(Number(limit || 50), 1), 200);
    if (!scheduleKey) throw new Error("scheduleKey is not configured");

    const now = Date.now();

    // Upstash/Redis raw args style (phổ biến):
    const members = await redis.zrange(scheduleKey, 0, now, {
      byScore: true,
      limit: {
        offset: 0,
        count: n,
      },
    });

    let moved = 0;
    for (const member of members || []) {
      // remove trước để tránh double
      const removed = await redis.zrem(scheduleKey, member);
      if (!removed) continue;

      await redis.lpush(queue, JSON.stringify(member));
      await redis.ltrim(queue, 0, Math.max(maxQueueLen - 1, 0));
      moved++;

      if (typeof onqueued === "function") {
        await onqueued(getStatusId(member), "queued", {
          queuedAt: new Date().toISOString(),
        });
      }
    }

    return { ok: true, moved };
  }

  return {
    prefix: prefixName,
    mode,
    queueKey: queue,
    dedupePrefix: dedupe,
    scheduleKey: toStr(scheduleKey),

    isAutoMode,
    pushOne,
    pushFromBatch,
    maybeEnqueueFromBatch,
    view,
    pop,
    del,
    size,
    clear,
    deleteDedupe,
    scheduleOne,
    moveDueToQueue,
  };
}

const newsQueue = makeQueue({
  prefix: NEWS_PREFIX,
  queueKey: NEWS_QUEUE,
  dedupePrefix: NEWS_DEDUPE,
  modeEnv: "NEWS_QUEUE_MODE",
  dedupeTtlSeconds: DEDUPE_TTL_SECONDS,
  onqueued: (id, status, meta) => newsStore.updateStatus(id, status, meta),
});

const socialQueue = makeQueue({
  prefix: SOCIAL_PREFIX,
  queueKey: SOCIAL_QUEUE,
  scheduleKey: SOCIAL_SCHEDULE,
  dedupePrefix: SOCIAL_DEDUPE,
  modeEnv: "SOCIAL_QUEUE_MODE",
  dedupeTtlSeconds: DEDUPE_TTL_SECONDS,
  onqueued: (id, status, meta) => socialStore.updateStatus(id, status, meta),
  statusIdFromId: (id) => toStr(id).split("|")[0],
});

const crawlQueue = makeQueue({
  prefix: CRAWL_PREFIX,
  queueKey: CRAWL_QUEUE,
  dedupePrefix: CRAWL_DEDUPE,
  modeEnv: "CRAWL_QUEUE_MODE",
  dedupeTtlSeconds: DEDUPE_TTL_SECONDS,
  onqueued: (rawId, status, meta) => {
    const [id, type, countRetry = "0"] = rawId.split("|");
    const retry = Number(countRetry) || 0;
    const payload = {
      ...meta,
      retry,
    };

    if (type === "news") {
      return newsStore.updateStatus(id, status, payload);
    }
    if (type === "social") {
      return socialStore.updateStatus(id, status, payload);
    }
  },
});

module.exports = { newsQueue, socialQueue, crawlQueue };
