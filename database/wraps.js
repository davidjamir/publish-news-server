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
    const operations = payload.map(async (item) => {
      try {
        if (!item.wrapDomain) {
          return {
            status: "skipped",
            blogDns: item.blogDns,
            reason: "No wrapDomain",
          };
        }

        const parsed = parseWrapDomain(item.wrapDomain);
        const wrap_host = parsed.wrap_host.toLowerCase().trim();
        const prefix = parsed.prefix.toLowerCase().trim();

        if (!wrap_host || !prefix) {
          throw new Error("Invalid wraps domain format");
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

        const result = await col.updateOne(filter, update, { upsert: true });

        return {
          status: "success",
          blogDns: item.blogDns,
          wrap_host,
          prefix,
          upsertedId: result.upsertedId || null,
          modifiedCount: result.modifiedCount,
        };
      } catch (error) {
        return {
          status: "error",
          blogDns: item.blogDns,
          wrapDomain: item.wrapDomain,
          error:
            error.code === 11000
              ? "Duplicate wrap_host + prefix"
              : error.message,
        };
      }
    });

    const results = await Promise.all(operations);
    const success = results.filter((r) => r.status === "success");
    const errors = results.filter((r) => r.status === "error");
    const skipped = results.filter((r) => r.status === "skipped");

    return {
      success: true,
      summary: {
        total: payload.length,
        success: success.length,
        errors: errors.length,
        skipped: skipped.length,
      },
      data: {
        success,
        errors,
        skipped,
      },
    };
  } catch (error) {
    console.error("Fatal error:", error);
    return { success: false, error: error.message };
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
