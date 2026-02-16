const { getDb } = require("./mongodb");
const { getDayKeyAndTtlSec } = require("../helper/timeZone");

// ===== Helpers =====

function getDateKey() {
  const date = getDayKeyAndTtlSec();
  return date.yyyymmdd;
}

function buildQuotaId(type, key, date) {
  return `${type}:${key}:${date}`;
}

function extractOriginFromSubdomain(subdomain) {
  const parts = subdomain.split(".");
  if (parts.length <= 2) return subdomain;

  return parts.slice(-2).join(".");
}

async function getCollection() {
  const db = await getDb();
  return db.collection("quotas");
}

// GET MANY QUOTAS TODAY (BY FILTER)

async function getQuotasToday(type, domains = []) {
  const col = await getCollection();
  const date = getDateKey();

  const query = {
    date,
    type,
  };

  if (Array.isArray(domains) && domains.length > 0) {
    query.key = { $in: domains };
  }

  const docs = col.find(query).toArray();
  const map = new Map();

  for (const doc of docs) {
    map.set(doc.key, doc);
  }

  return map;
}

async function increaseQuota({ type, key, limit = 100 }) {
  const col = await getCollection();
  const date = getDateKey();
  const now = new Date();

  const ops = [];

  function buildDoc(t, k, l, p) {
    return {
      _id: buildQuotaId(t, k, date),
      type: t,
      key: k,
      date,
      count: 1,
      limit: l,
      createdAt: now,
      updatedAt: now,
    };
  }

  // 1️⃣ tăng chính nó (có upsert)
  ops.push(
    col.updateOne(
      { _id: buildQuotaId(type, key, date) },
      {
        $inc: { count: 1 },
        $set: { updatedAt: now },
        $setOnInsert: buildDoc(type, key, limit + 1),
      },
      { upsert: true },
    ),
  );

  // nếu là subdomain thì tăng origin luôn
  if (type === "subdomain") {
    const origin = extractOriginFromSubdomain(key);

    ops.push(
      col.updateOne(
        { _id: buildQuotaId("origin", origin, date) },
        {
          $inc: { count: 1 },
          $set: { updatedAt: now },
          $setOnInsert: buildDoc("origin", origin, 501),
        },
        { upsert: true },
      ),
    );
  }

  return Promise.all(ops);
}

module.exports = {
  getQuotasToday,
  increaseQuota,
  extractOriginFromSubdomain,
};
