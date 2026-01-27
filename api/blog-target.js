const { isAuthorized } = require("../helper/isAuthorized");
const { redis } = require("../src/redis");
const { safeParse } = require("../helper/safeParse");
const { toStr } = require("../helper/toString");

const BLOG_TARGET_KEY = "blog-target";

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
      const raw = await redis.get(BLOG_TARGET_KEY);
      const data = safeParse(raw) || { targets: [] };
      if (!Array.isArray(data.targets)) data.targets = [];
      return res.json({
        ok: true,
        key: BLOG_TARGET_KEY,
        count: data.targets.length,
        ...data,
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
      for (const t of targets) {
        const blogDns = normDns(t?.blogDns);
        const blogEmail = toStr(t?.blogEmail);
        if (!blogDns)
          return res
            .status(400)
            .json({ ok: false, error: "blogDns is required" });
        if (!blogEmail || !isValidEmail(blogEmail)) {
          return res
            .status(400)
            .json({ ok: false, error: `invalid blogEmail for ${blogDns}` });
        }
        if (seen.has(blogDns)) {
          return res
            .status(400)
            .json({ ok: false, error: `duplicate blogDns: ${blogDns}` });
        }
        seen.add(blogDns);
      }

      await redis.set(BLOG_TARGET_KEY, JSON.stringify({ targets }));

      return res.json({
        ok: true,
        key: BLOG_TARGET_KEY,
        count: targets.length,
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
