const { isAuthorized } = require("../helper/isAuthorized");
const { toStr } = require("../helper/toString");
const { getAllBlogs, insertManyBlogs } = require("../database/blogs");
const { insertManyWraps } = require("../database/wraps");

function normDns(s) {
  return toStr(s).toLowerCase();
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    if (req.method === "GET") {
      const blogs = await getAllBlogs();

      return res.json({
        ok: true,
        count: blogs.length,
        blogs,
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const targets = body.targets;

      if (!Array.isArray(targets)) {
        return res
          .status(400)
          .json({ ok: false, error: "targets must be an array" });
      }

      const seen = new Set();
      const results = [];
      for (const t of targets) {
        const blogDns = normDns(t?.blogDns);
        const blogEmail = toStr(t?.blogEmail);
        if (!blogDns) continue;
        if (!blogEmail || !isValidEmail(blogEmail)) continue;
        if (seen.has(blogDns)) continue;

        seen.add(blogDns);
        results.push({
          blogIndex: t.blogIndex,
          blogDns,
          blogEmail,
          blogUser: t.blogUser,
          blogPassword: t.blogPassword,
          blogPriority: t.blogPriority,
          wrapDomain: t.wrapDomain,
          channel: t.channel,
          enabled: t.enabled,
        });
      }

      await insertManyBlogs(results);
      await insertManyWraps(results);

      return res.json({
        ok: true,
        count: results.length,
      });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/blog-target] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
