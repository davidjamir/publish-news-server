const { getDb } = require("./mongodb"); // MongoDB client

// Tạo một kết nối tới MongoDB và lấy collection "blogs"
async function getCollection() {
  const db = await getDb();
  return db.collection("ads");
}

// Thêm nhiều tài liệu vào collection
async function insertManyAds(payload) {
  try {
    const col = await getCollection();
    const operations = payload.map((item) => {
      const filter = {
        domain: item.domain,
        source: item.source,
        name: item.name,
      };
      const update = {
        $set: {
          ...item,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
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
      message: "Ads successfully saved/updated.",
    };
  } catch (error) {
    console.error("Error inserting documents:", error);
    throw error;
  }
}

async function insertOneAds(payload) {
  try {
    const col = await getCollection();
    const filter = {
      domain: item.domain,
      source: item.source,
      name: item.name,
    };
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
async function getAllAds() {
  try {
    const col = await getCollection();
    const ads = await col.find().sort({ createdAt: 1 }).toArray();
    return ads;
  } catch (error) {
    console.error("Error fetching all documents:", error);
    throw error;
  }
}

// Lấy một tài liệu theo điều kiện
async function getOneAd(filter) {
  try {
    const col = await getCollection();
    const blog = await col.findOne(filter);
    return blog;
  } catch (error) {
    console.error("Error fetching one document:", error);
    throw error;
  }
}

// Lấy nhiều tài liệu theo điều kiện
async function getManyAds(filter) {
  try {
    const col = await getCollection();
    const ads = await col.find(filter).sort({ createdAt: 1 }).toArray();
    return ads;
  } catch (error) {
    console.error("Error fetching multiple documents:", error);
    throw error;
  }
}

// Cập nhật một tài liệu theo điều kiện
async function updateOneAd(filter, updateData) {
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
async function updateManyAds(filter, updateData) {
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
async function deleteOneAd(filter) {
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
async function deleteManyAds(filter) {
  try {
    const col = await getCollection();
    const result = await col.deleteMany(filter);
    return result;
  } catch (error) {
    console.error("Error deleting multiple documents:", error);
    throw error;
  }
}

module.exports = {
  insertManyAds,
  insertOneAds,
  getAllAds,
  getOneAd,
  getManyAds,
  updateOneAd,
  updateManyAds,
  deleteOneAd,
  deleteManyAds,
};
