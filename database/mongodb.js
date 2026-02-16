// src/mongodb.js
const { MongoClient } = require("mongodb");
const { attachDatabasePool } = require("@vercel/functions");

const options = {
  appName: "devrel.vercel.integration", // Tên ứng dụng của bạn
  maxIdleTimeMS: 5000, // Cấu hình thời gian tối đa kết nối idle
};

// Kết nối MongoDB với URI từ biến môi trường
const client = new MongoClient(process.env.MONGODB_URI, options);

// Attach MongoDB client vào database pool của Vercel
attachDatabasePool(client);

let _db;

async function getDb() {
  if (_db) return _db;

  // ⚠️ QUAN TRỌNG: attachDatabasePool KHÔNG tự connect
  if (!client.topology?.isConnected()) {
    await client.connect();
  }

  _db = client.db(process.env.MONGODB_DB || "server-news");

  // Tạo TTL Index nếu chưa có
  await createTTLIndex(_db.collection("news"));
  await createTTLIndex(_db.collection("social"));
  await createTTLIndex(_db.collection("batches"));
  await createTTLIndex(_db.collection("links"));
  await createTTLIndex(_db.collection("quotas"));
  return _db;
}

// Tạo TTL Index cho trường createdAt trong collection
async function createTTLIndex(col) {
  // Kiểm tra nếu TTL Index đã tồn tại
  const indexes = await col.indexes();
  const ttlIndexExists = indexes.some((index) => index.key.createdAt);

  if (!ttlIndexExists) {
    await col.createIndex(
      { createdAt: 1 }, // Sắp xếp tăng dần theo createdAt
      { expireAfterSeconds: 60 * 60 * 24 * 10 }, // Tài liệu sẽ hết hạn sau 10 ngày
    );
    console.log(`TTL Index created for collection: ${col.collectionName}`);
  }
}

// Export MongoClient cho các route hoặc file khác có thể sử dụng lại
module.exports = {
  getDb,
};
