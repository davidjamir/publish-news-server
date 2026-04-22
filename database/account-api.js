const { getDb } = require("./mongodb"); // MongoDB client

// Tạo một kết nối tới MongoDB và lấy collection "blogs"
async function getCollection() {
  const db = await getDb();
  return db.collection("account_api");
}

// Lấy một tài liệu theo điều kiện
async function getOneAccountAPI(filter) {
  try {
    const col = await getCollection();
    const account = await col.findOne(filter);
    return account;
  } catch (error) {
    console.error("Error fetching one document:", error);
    throw error;
  }
}

module.exports = { getOneAccountAPI };
