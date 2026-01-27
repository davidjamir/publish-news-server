// api/news.js
const { isAuthorized } = require("../helper/isAuthorized");
const { newsStore } = require("../src/store");
const { isTruthy } = require("../helper/isTruthy");
const { toStr } = require("../helper/toString");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const rawLimit = url.searchParams.get("limit");
    const rawClearAll = url.searchParams.get("clearAll");
    const newsId = toStr(url.searchParams.get("newsId"));

    if (req.method === "GET") {
      // Mode 1: detail
      if (newsId) {
        const payload = await newsStore.get(newsId);
        if (!payload) {
          return res.status(404).json({
            ok: false,
            error: "News not found (expired or deleted)",
            newsId,
          });
        }
        return res
          .status(200)
          .json({ ok: true, mode: "detail", newsId, payload });
      }

      // Mode 2: list
      const limit = rawLimit == null ? 10 : Number(String(rawLimit).trim());
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return res
          .status(400)
          .json({ ok: false, error: "limit must be a number (1..50)" });
      }

      const news = await newsStore.view(limit);

      return res.status(200).json({
        ok: true,
        mode: "list",
        limit,
        size: news.length,
        news,
      });
    }

    if (req.method === "DELETE") {
      // Mode: clear all
      if (isTruthy(rawClearAll)) {
        const result = await newsStore.clear();
        return res.status(200).json({ ok: true, mode: "clearAll", ...result });
      }

      // Mode: delete one
      if (!newsId) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing newsId (or use ?clearAll=1)" });
      }

      const result = await newsStore.del(newsId);
      return res.status(200).json({ ok: true, mode: "deleteOne", ...result });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/news] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
