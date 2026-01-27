// api/batch.js
const { isAuthorized } = require("../helper/isAuthorized");
const { batchStore } = require("../src/store");
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
    const batchId = toStr(url.searchParams.get("batchId"));

    if (req.method === "GET") {
      // Mode 1: detail
      if (batchId) {
        const payload = await batchStore.get(batchId);
        if (!payload) {
          return res.status(404).json({
            ok: false,
            error: "Batch not found (expired or deleted)",
            batchId,
          });
        }
        return res
          .status(200)
          .json({ ok: true, mode: "detail", batchId, payload });
      }

      // Mode 2: list
      const limit = rawLimit == null ? 10 : Number(String(rawLimit).trim());
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return res
          .status(400)
          .json({ ok: false, error: "limit must be a number (1..50)" });
      }

      const batches = await batchStore.view(limit);

      return res.status(200).json({
        ok: true,
        mode: "list",
        limit,
        size: batches.length,
        batches,
      });
    }

    if (req.method === "DELETE") {
      // Mode: clear all
      if (isTruthy(rawClearAll)) {
        const result = await batchStore.clear();
        return res.status(200).json({ ok: true, mode: "clearAll", ...result });
      }

      // Mode: delete one
      if (!batchId) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing batchId (or use ?clearAll=1)" });
      }

      const result = await batchStore.del(batchId);
      return res.status(200).json({ ok: true, mode: "deleteOne", ...result });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/batch] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
