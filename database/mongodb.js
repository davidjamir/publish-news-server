// src/mongodb.js
const { MongoClient } = require("mongodb");
const { attachDatabasePool } = require("@vercel/functions");

const options = {
  appName: "devrel.vercel.integration", // Tên ứng dụng của bạn
  maxIdleTimeMS: 5000, // Cấu hình thời gian tối đa kết nối idle
};

const clients = {
  default: new MongoClient(process.env.MONGODB_URI, options),
  batches: new MongoClient(process.env.MONGODB_URI_1, options),
  social: new MongoClient(process.env.MONGODB_URI_2, options),
  news: new MongoClient(process.env.MONGODB_URI_3, options),
};

// Attach MongoDB client vào database pool của Vercel
Object.values(clients).forEach((client) => {
  attachDatabasePool(client);
});

const dbCache = {};
const indexInitialized = {};

async function getDb(type = "default") {
  if (dbCache[type]) return dbCache[type];

  const client = clients[type] || clients.default;

  if (!client.topology?.isConnected()) {
    await client.connect();
  }

  const db = client.db(process.env.MONGODB_DB || "databases");

  dbCache[type] = db;

  // Tạo index lần đầu cho DB này
  if (!indexInitialized[type]) {
    await initIndexes(db, type);
    indexInitialized[type] = true;
  }

  return db;
}

async function initIndexes(db, type) {
  // TTL cho các collection cần expire
  const ttlCollections = ["news", "social", "batches", "links", "quotas"];

  for (const name of ttlCollections) {
    try {
      await db.collection(name).createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 60 * 60 * 24 * 10 }, // Hiện tại là 10 ngà
      );
    } catch (err) {
      console.error(`Index error for ${name}:`, err.message);
    }
  }

  // Index riêng cho wraps (chỉ default DB)
  if (type === "default") {
    await db
      .collection("wraps")
      .createIndex({ wrap_host: 1, prefix: 1 }, { unique: true });
  }
}

async function getCollection(name) {
  if (name === "batches") {
    const db = await getDb("batches");
    return db.collection("batches");
  }

  if (name === "social") {
    const db = await getDb("social");
    return db.collection("social");
  }

  if (name === "news") {
    const db = await getDb("news");
    return db.collection("news");
  }

  const db = await getDb("default");
  return db.collection(name);
}

module.exports = {
  getDb,
  getCollection,
};
