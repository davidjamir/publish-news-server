const { getDb } = require("./mongodb");
const { getDayKeyAndTtlSec } = require("../helper/timeZone");
const { extractOriginFromSubdomain } = require("../helper/extractOrigin");

const ORIGIN_LIMIT_DEFAULT = 300;
const SUBDOMAIN_LIMIT_DEFAULT = 40;
// ===== Helpers =====

function getDateKey() {
  const date = getDayKeyAndTtlSec();
  return date.yyyymmdd;
}

function buildQuotaId(type, key, date) {
  return `${type}:${key}:${date}`;
}

async function getCollection() {
  const db = await getDb();
  return db.collection("quotas");
}

// GET MANY QUOTAS TODAY (BY FILTER)

async function getQuotasToday(type, keys = []) {
  const col = await getCollection();
  const date = getDateKey();

  const query = {
    date,
    type,
  };

  if (Array.isArray(keys) && keys.length > 0) {
    query.key = { $in: keys };
  }

  const docs = await col.find(query).toArray();
  const map = new Map();

  for (const doc of docs) {
    map.set(doc.key, doc);
  }

  return map;
}

async function increaseQuota({
  type,
  user,
  domain,
  limit = SUBDOMAIN_LIMIT_DEFAULT,
}) {
  const col = await getCollection();
  const date = getDateKey();
  const now = new Date();

  const ops = [];

  function buildDoc({ type, key, user, origin, domain, limit }) {
    return {
      _id: buildQuotaId(type, key, date),
      type,
      key,
      user,
      origin,
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
          user,
          origin: extractOriginFromSubdomain(domain),
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
            user,
            origin,
            domain: origin,
            limit: ORIGIN_LIMIT_DEFAULT,
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
