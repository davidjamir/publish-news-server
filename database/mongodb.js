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
  return _db;
}

// Export MongoClient cho các route hoặc file khác có thể sử dụng lại
module.exports = {
  getDb,
};
