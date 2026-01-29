// store.js
const { redis } = require("./redis");
const { safeParse } = require("../helper/safeParse");
const { toStr } = require("../helper/toString");

const BATCH_KEY_PREFIX = "batch";
const BATCH_LIST = "batch:list";
const BATCH_TTL_SECONDS = 10 * 24 * 60 * 60;

const NEWS_KEY_PREFIX = "news:item";
const NEWS_LIST = "news:item:list";
const NEWS_TTL_SECONDS = 10 * 24 * 60 * 60;

const SOCIAL_KEY_PREFIX = "social:item";
const SOCIAL_LIST = "social:item:list";
const SOCIAL_TTL_SECONDS = 10 * 24 * 60 * 60;

const LINK_KEY_PREFIX = "link:item";
const LINK_LIST = "link:item:list";
const LINK_TTL_SECONDS = 10 * 24 * 60 * 60;

function makeStore({
  keyPrefix, // vd: "batch" hoặc "news:item" hoặc "social:item"
  keyList, // vd: "batch:list" hoặc "news:item:list"
  ttlSeconds = null, // null = không TTL, hoặc số giây
  maxList = 100000,
  validatePayload, // optional: fn(payload)
  getIdFromPayload, // optional: fn(payload) => id
} = {}) {
  const KP = toStr(keyPrefix);
  const KL = toStr(keyList);
  if (!KP) throw new Error("keyPrefix is required");
  if (!KL) throw new Error("keyList is required");

  function keyOf(id) {
    const s = toStr(id);
    if (!s) throw new Error("id is required");
    return `${KP}:${s}`;
  }

  async function fetchOrCleanup(id) {
    const raw = await redis.get(keyOf(id));
    if (!raw) {
      await redis.lrem(KL, 0, String(id)); // dọn rác
      return null;
    }
    return safeParse(raw);
  }

  async function push(payload) {
    if (validatePayload) validatePayload(payload);

    const id = toStr(
      getIdFromPayload ? getIdFromPayload(payload) : payload?.id,
    );
    if (!id) throw new Error("payload id is required");

    // set KV (có TTL hoặc không)
    if (ttlSeconds && Number(ttlSeconds) > 0) {
      await redis.set(keyOf(id), JSON.stringify(payload), { ex: ttlSeconds });
    } else {
      await redis.set(keyOf(id), JSON.stringify(payload));
    }

    // cập nhật list newest-first, dedupe trong list
    await redis
      .multi()
      .lrem(KL, 0, id)
      .lpush(KL, id)
      .ltrim(KL, 0, Math.max(maxList - 1, 0))
      .exec();

    return { ok: true, id, key: keyOf(id), keyList: KL };
  }

  async function get(id) {
    return await fetchOrCleanup(id);
  }

  async function del(id) {
    const s = toStr(id);
    if (!s) throw new Error("id is required");
    await redis.del(keyOf(s));
    await redis.lrem(KL, 0, s);
    return { ok: true, id: s, deleted: true };
  }

  async function view(limit = 10) {
    const n = Math.min(Math.max(Number(limit || 10), 1), 50);
    const ids = await redis.lrange(KL, 0, n - 1);

    const out = [];
    for (const id of ids || []) {
      const payload = await fetchOrCleanup(String(id));
      if (payload) out.push(payload);
    }
    return out;
  }

  async function update(id, patch = {}) {
    const _id = toStr(id);
    if (!_id) throw new Error("id is required");
    if (!isObj(patch)) throw new Error("patch must be an object");

    const cur = await get(_id);
    if (!cur) return { ok: false, error: "Not found", id: _id };

    const updated = {
      ...cur,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await push(updated);
    return { ok: true, id: _id };
  }

  async function clear() {
    const ids = await redis.lrange(KL, 0, -1);

    if (ids && ids.length) {
      const keys = ids.map((id) => keyOf(id)).filter(Boolean);
      if (keys.length) await redis.del(...keys);
    }
    await redis.del(KL);
    return { ok: true, cleared: ids ? ids.length : 0 };
  }

  async function updateStatus(id, status, extra = {}) {
    const _id = toStr(id);
    const st = toStr(status);
    if (!_id) throw new Error("id is required");
    if (!st) throw new Error("status is required");

    const cur = await get(_id);
    if (!cur) return { ok: false, error: "Not found", id: _id };

    const updated = {
      ...cur,
      status: st,
      ...extra,
      updatedAt: new Date().toISOString(),
    };

    await push(updated);
    return { ok: true, id: _id, status: st };
  }

  return { keyOf, push, get, view, del, update, clear, updateStatus };
}

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function validateBatch(payload) {
  if (!isObj(payload)) throw new Error("payload must be an object");
  if (!toStr(payload.batchId)) throw new Error("payload.batchId is required");
  if (!toStr(payload.chatId)) throw new Error("payload.chatId is required");
  if (!isObj(payload.source)) throw new Error("payload.source is required");
  if (!toStr(payload.source.feedUrl))
    throw new Error("payload.source.feedUrl is required");
  if (!Array.isArray(payload.items))
    throw new Error("payload.items must be an array");
  if (payload.items.length === 0)
    throw new Error("payload.items must not be empty");
  if (!Array.isArray(payload.topics))
    throw new Error("payload.topics must be an array when provided");
  if (!Array.isArray(payload.flags))
    throw new Error("payload.flags must be an array when provided");
  if (!Array.isArray(payload.targets))
    throw new Error("payload.targets must be an array when provided");
}

function validateItem(payload) {
  if (!isObj(payload)) throw new Error("payload must be an object");
  if (!toStr(payload.itemId)) throw new Error("payload.itemId is required");
  if (!toStr(payload.batchId)) throw new Error("payload.batchId is required");
  if (!toStr(payload.title)) throw new Error("payload.title is required");
  if (!toStr(payload.link)) throw new Error("payload.link is required");
  if (!toStr(payload.guid)) throw new Error("payload.guid is required");
  if (!toStr(payload.snippet)) throw new Error("payload.snippet is required");
  if (!toStr(payload.status)) throw new Error("payload.status is required");
  if (!toStr(payload.type)) throw new Error("payload.type is required");
  if (!toStr(payload.publishedAt))
    throw new Error("payload.publishedAt is required");
  if (!Array.isArray(payload.topics))
    throw new Error("payload.topics must be an array when provided");
  if (!Array.isArray(payload.targets))
    throw new Error("payload.targets must be an array when provided");
}

const batchStore = makeStore({
  keyPrefix: BATCH_KEY_PREFIX,
  keyList: BATCH_LIST,
  ttlSeconds: BATCH_TTL_SECONDS,
  validatePayload: validateBatch,
  getIdFromPayload: (p) => p.batchId,
});

const newsStore = makeStore({
  keyPrefix: NEWS_KEY_PREFIX,
  keyList: NEWS_LIST,
  ttlSeconds: NEWS_TTL_SECONDS,
  validatePayload: validateItem,
  getIdFromPayload: (p) => p.itemId,
});

const socialStore = makeStore({
  keyPrefix: SOCIAL_KEY_PREFIX,
  keyList: SOCIAL_LIST,
  ttlSeconds: SOCIAL_TTL_SECONDS,
  validatePayload: validateItem,
  getIdFromPayload: (p) => p.itemId,
});

const linkStore = makeStore({
  keyPrefix: LINK_KEY_PREFIX,
  keyList: LINK_LIST,
  ttlSeconds: LINK_TTL_SECONDS,
  getIdFromPayload: (p) => p.link,
});

module.exports = { batchStore, newsStore, socialStore, linkStore };
