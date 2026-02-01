const { getDb } = require("./mongodb"); // MongoDB client

// Hàm lấy collection theo tên collection truyền vào
async function getCollection(collectionName) {
  const db = await getDb();
  return db.collection(collectionName);
}

// Thêm nhiều tài liệu vào collection
async function insertManyItems(collectionName, payload) {
  try {
    const col = await getCollection(collectionName);
    const result = await col.insertMany(payload);
    return result;
  } catch (error) {
    console.error("Error inserting documents:", error);
    throw error;
  }
}

async function insertOneItem(collectionName, filter, payload) {
  try {
    const col = await getCollection(collectionName);
    const update = {
      $set: {
        ...payload,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    };
    const result = await col.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: "after",
    });
    return result;
  } catch (error) {
    console.error("Error inserting document:", error);
    throw error;
  }
}

// Lấy tất cả tài liệu trong collection
async function getAllItems(collectionName) {
  try {
    const col = await getCollection(collectionName);
    const documents = await col.find().sort({ createdAt: 1 }).toArray();
    return documents;
  } catch (error) {
    console.error(
      `Error fetching all documents from ${collectionName}:`,
      error,
    );
    throw error;
  }
}

// Lấy một tài liệu theo điều kiện
async function getOneItem(collectionName, filter) {
  try {
    const col = await getCollection(collectionName);
    const document = await col.findOne(filter);
    return document;
  } catch (error) {
    console.error(`Error fetching one document from ${collectionName}:`, error);
    throw error;
  }
}

// Lấy nhiều tài liệu theo điều kiện
async function getManyItems(
  collectionName,
  filter,
  limit = 10,
  sortDesc = false,
) {
  try {
    const col = await getCollection(collectionName);
    const sortOrder = sortDesc ? -1 : 1;
    const documents = await col
      .find(filter)
      .limit(limit)
      .sort({ createdAt: sortOrder })
      .toArray();
    return documents;
  } catch (error) {
    console.error(
      `Error fetching multiple documents from ${collectionName}:`,
      error,
    );
    throw error;
  }
}

// Cập nhật một tài liệu theo điều kiện
async function updateOneItem(collectionName, filter, updateData) {
  try {
    const col = await getCollection(collectionName);
    const result = await col.updateOne(filter, {
      $set: { ...updateData, updatedAt: new Date() },
    });
    return result;
  } catch (error) {
    console.error("Error updating one document:", error);
    throw error;
  }
}

// Cập nhật nhiều tài liệu theo điều kiện
async function updateManyItems(collectionName, filter, updateData) {
  try {
    const col = await getCollection(collectionName);
    const result = await col.updateMany(filter, { $set: updateData });
    return result;
  } catch (error) {
    console.error(
      `Error updating multiple documents in ${collectionName}:`,
      error,
    );
    throw error;
  }
}

// Xóa một tài liệu theo điều kiện
async function deleteOneItem(collectionName, filter) {
  try {
    const col = await getCollection(collectionName);
    const result = await col.deleteOne(filter);
    return result;
  } catch (error) {
    console.error(`Error deleting one document from ${collectionName}:`, error);
    throw error;
  }
}

// Xóa nhiều tài liệu theo điều kiện
async function deleteManyItems(collectionName, filter) {
  try {
    const col = await getCollection(collectionName);
    const result = await col.deleteMany(filter);
    return result;
  } catch (error) {
    console.error(
      `Error deleting multiple documents from ${collectionName}:`,
      error,
    );
    throw error;
  }
}

module.exports = {
  insertManyItems,
  getAllItems,
  getOneItem,
  getManyItems,
  updateOneItem,
  updateManyItems,
  deleteOneItem,
  deleteManyItems,
  insertOneItem,
};
