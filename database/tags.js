const { getDb } = require("./mongodb"); // MongoDB client

// Tạo một kết nối tới MongoDB và lấy collection "blogs"
async function getCollection() {
  const db = await getDb();
  return db.collection("tags");
}

// Thêm nhiều tài liệu vào collection
async function insertManyTags(payload) {
  try {
    const col = await getCollection();
    const operations = payload.map((item) => {
      const filter = { name: item };
      const update = {
        $set: {
          name: item,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
          lastKeywordUpdate: Date.now(),
        },
      };

      return col.findOneAndUpdate(filter, update, {
        upsert: true,
        returnDocument: "after",
      });
    });

    await Promise.all(operations);
    return {
      success: true,
      message: "Tags successfully saved/updated.",
    };
  } catch (error) {
    console.error("Error inserting documents:", error);
    throw error;
  }
}

// Lấy nhiều tài liệu theo điều kiện
async function getManyTags(filter, limit) {
  try {
    const col = await getCollection();
    const tags = await col
      .find(filter)
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    return tags;
  } catch (error) {
    console.error("Error fetching multiple documents:", error);
    throw error;
  }
}

// Cập nhật một tài liệu theo điều kiện
async function updateOneTag(filter, updateData) {
  try {
    const col = await getCollection();
    const result = await col.updateOne(filter, { $set: updateData });
    return result;
  } catch (error) {
    console.error("Error updating one document:", error);
    throw error;
  }
}

module.exports = {
  insertManyTags,
  getManyTags,
  updateOneTag,
};
