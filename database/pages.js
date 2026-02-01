const { getDb } = require("./mongodb"); // MongoDB client

// Tạo một kết nối tới MongoDB và lấy collection "pages"
async function getCollection() {
  const db = await getDb();
  return db.collection("pages");
}

// Thêm nhiều tài liệu vào collection
async function insertManyPages(payload) {
  try {
    const col = await getCollection();
    const result = await col.insertMany(payload);
    return result;
  } catch (error) {
    console.error("Error inserting documents:", error);
    throw error;
  }
}

// Lấy tất cả tài liệu trong collection
async function getAllPages() {
  try {
    const col = await getCollection();
    const pages = await col.find().sort({ createdAt: 1 }).toArray();
    return pages;
  } catch (error) {
    console.error("Error fetching all documents:", error);
    throw error;
  }
}

// Lấy một tài liệu theo điều kiện
async function getOnePage(filter) {
  try {
    const col = await getCollection();
    const page = await col.findOne(filter);
    return page;
  } catch (error) {
    console.error("Error fetching one document:", error);
    throw error;
  }
}

// Lấy nhiều tài liệu theo điều kiện
async function getManyPages(filter) {
  try {
    const col = await getCollection();
    const pages = await col.find(filter).sort({ createdAt: 1 }).toArray();
    return pages;
  } catch (error) {
    console.error("Error fetching multiple documents:", error);
    throw error;
  }
}

// Cập nhật một tài liệu theo điều kiện
async function updateOnePage(filter, updateData) {
  try {
    const col = await getCollection();
    const result = await col.updateOne(filter, { $set: updateData });
    return result;
  } catch (error) {
    console.error("Error updating one document:", error);
    throw error;
  }
}

// Cập nhật nhiều tài liệu theo điều kiện
async function updateManyPages(filter, updateData) {
  try {
    const col = await getCollection();
    const result = await col.updateMany(filter, { $set: updateData });
    return result;
  } catch (error) {
    console.error("Error updating multiple documents:", error);
    throw error;
  }
}

// Xóa một tài liệu theo điều kiện
async function deleteOnePage(filter) {
  try {
    const col = await getCollection();
    const result = await col.deleteOne(filter);
    return result;
  } catch (error) {
    console.error("Error deleting one document:", error);
    throw error;
  }
}

// Xóa nhiều tài liệu theo điều kiện
async function deleteManyPages(filter) {
  try {
    const col = await getCollection();
    const result = await col.deleteMany(filter);
    return result;
  } catch (error) {
    console.error("Error deleting multiple documents:", error);
    throw error;
  }
}

// Ví dụ sử dụng: insertOne (chèn một tài liệu mới)
async function insertOnePage(payload) {
  try {
    const col = await getCollection();
    const result = await col.insertOne(payload);
    return result;
  } catch (error) {
    console.error("Error inserting document:", error);
    throw error;
  }
}

module.exports = {
  insertManyPages,
  getAllPages,
  getOnePage,
  getManyPages,
  updateOnePage,
  updateManyPages,
  deleteOnePage,
  deleteManyPages,
  insertOnePage,
};
