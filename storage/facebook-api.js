// /api/facebook-api.js
const { isAuthorized } = require("../helper/isAuthorized");
const { getAllPages } = require("../database/pages");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    // GET: xem config đang lưu (default: masked)
    if (req.method === "GET") {
      const pages = await getAllPages();

      return res.json({
        ok: true,
        count: pages.length,
        pages,
      });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/facebook-api] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
