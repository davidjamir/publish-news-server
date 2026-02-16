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

  const docs = await col.find(query).toArray();
  const map = new Map();

  for (const doc of docs) {
    map.set(doc.key, doc);
  }

  return map;
}

async function increaseQuota({ type, user, domain, limit = 100 }) {
  const col = await getCollection();
  const date = getDateKey();
  const now = new Date();

  const ops = [];

  function buildDoc({ type, key, domain, limit }) {
    return {
      _id: buildQuotaId(type, key, date),
      type,
      key,
      domain,
      limit,
      date,
      createdAt: now,
    };
  }

  // 1️⃣ tăng chính nó (có upsert)
  ops.push(
    col.updateOne(
      { _id: buildQuotaId(type, `${user}:${domain}`, date) },
      {
        $inc: { count: 1 },
        $set: { updatedAt: now },
        $setOnInsert: buildDoc({
          type,
          key: `${user}:${domain}`,
          domain,
          limit,
        }),
      },
      { upsert: true },
    ),
  );

  // nếu là subdomain thì tăng origin luôn
  if (type === "subdomain") {
    const origin = extractOriginFromSubdomain(domain);

    ops.push(
      col.updateOne(
        { _id: buildQuotaId("origin", `${user}:${origin}`, date) },
        {
          $inc: { count: 1 },
          $set: { updatedAt: now },
          $setOnInsert: buildDoc({
            type: "origin",
            key: `${user}:${origin}`,
            domain: origin,
            limit: 500,
          }),
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
