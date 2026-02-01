const { getDb } = require("./mongodb"); // MongoDB client

// Tạo một kết nối tới MongoDB và lấy collection "blogs"
async function getCollection() {
  const db = await getDb();
  return db.collection("blogs");
}

// Thêm nhiều tài liệu vào collection
async function insertManyBlogs(payload) {
  try {
    const col = await getCollection();
    const operations = payload.map((item) => {
      const filter = { blogDns: item.blogDns };
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
      message: "Pages successfully saved/updated.",
    };
  } catch (error) {
    console.error("Error inserting documents:", error);
    throw error;
  }
}

// Lấy tất cả tài liệu trong collection
async function getAllBlogs() {
  try {
    const col = await getCollection();
    const blogs = await col.find().sort({ blogIndex: 1 }).toArray();
    return blogs;
  } catch (error) {
    console.error("Error fetching all documents:", error);
    throw error;
  }
}

// Lấy một tài liệu theo điều kiện
async function getOneBlog(filter) {
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
async function getManyBlogs(filter) {
  try {
    const col = await getCollection();
    const blogs = await col.find(filter).sort({ createdAt: 1 }).toArray();
    return blogs;
  } catch (error) {
    console.error("Error fetching multiple documents:", error);
    throw error;
  }
}

// Cập nhật một tài liệu theo điều kiện
async function updateOneBlog(filter, updateData) {
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
async function updateManyBlogs(filter, updateData) {
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
async function deleteOneBlog(filter) {
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
async function deleteManyBlogs(filter) {
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
async function insertOneBlog(payload) {
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
  insertManyBlogs,
  getAllBlogs,
  getOneBlog,
  getManyBlogs,
  updateOneBlog,
  updateManyBlogs,
  deleteOneBlog,
  deleteManyBlogs,
  insertOneBlog,
};
