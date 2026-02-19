const { getDb } = require("./mongodb"); // MongoDB client

function parseWrapDomain(blogDns) {
  if (!blogDns) return {};
  const parts = blogDns.split("/").filter(Boolean);

  return {
    wrap_host: parts[0],
    prefix: parts[1] || null,
  };
}

// Tạo một kết nối tới MongoDB và lấy collection "blogs"
async function getCollection() {
  const db = await getDb();
  return db.collection("wraps");
}

// Thêm nhiều tài liệu vào collection
async function insertManyWraps(payload) {
  try {
    const col = await getCollection();
    const operations = payload.map((item) => {
      const { wrap_host, prefix } = parseWrapDomain(item.wrapDomain);
      if (!wrap_host || !prefix) {
        throw new Error("Invalid blogDns format");
      }

      const filter = { wrap_host, prefix };

      const update = {
        $set: {
          wrap_host,
          prefix,
          target_host: item.blogDns, // nhớ gửi lên
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      };

      return col.updateOne(filter, update, { upsert: true });
    });

    await Promise.all(operations);
    return {
      success: true,
      message: "Wraps successfully saved/updated.",
    };
  } catch (error) {
    console.error("Error inserting documents:", error);
    return { success: false };
  }
}

// Lấy tất cả tài liệu trong collection
async function getAllWraps() {
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
async function getOneWrapDomain(filter) {
  try {
    const col = await getCollection();
    const blog = await col.findOne(filter);
    return blog;
  } catch (error) {
    console.error("Error fetching one document:", error);
    throw error;
  }
}

module.exports = {
  insertManyWraps,
  getAllWraps,
  getOneWrapDomain,
};
