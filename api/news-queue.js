const { isAuthorized } = require("../helper/isAuthorized");
const { newsQueue } = require("../src/queue");
const { batchStore, newsStore } = require("../src/store");
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
    const limit = rawLimit == null ? 10 : Number(String(rawLimit).trim());
    const clearAll = isTruthy(url.searchParams.get("clearAll"));
    const batchId = toStr(url.searchParams.get("batchId"));
    const newsId = toStr(url.searchParams.get("newsId"));
    const force = isTruthy(url.searchParams.get("force"));
    const action =
      toStr(url.searchParams.get("action")).toLowerCase() || "enqueue";

    // GET: view queue
    if (req.method === "GET") {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return res
          .status(400)
          .json({ ok: false, error: "limit must be an integer 1..50" });
      }

      const items = await newsQueue.view(limit);
      const size = await newsQueue.size();

      return res.json({ ok: true, limit, size, items });
    }

    // POST: enqueue/retry/enqueueBatch
    if (req.method === "POST") {
      // retry or enqueue single item
      if (action === "enqueue") {
        if (!newsId)
          return res.status(400).json({ ok: false, error: "Missing newsId" });

        if (force) {
          await newsQueue.del(newsId);
          await newsQueue.deleteDedupe(newsId);
        }
        const item = await newsStore.get(newsId);
        if (!item) {
          return res
            .status(400)
            .json({ ok: false, error: "Item not found (expired or deleted)" });
        }
        if (item.type !== "news") {
          return res
            .status(400)
            .json({ ok: false, error: "Item is not newsItem" });
        }
        // nếu vẫn dùng payload {id,batchId} thì dùng kiểu cũ
        const r = await newsQueue.pushOne(newsId, { dedupe: true });

        return res.json({ ok: true, action, newsId, ...r });
      }

      // enqueue from batch
      if (action === "enqueuebatch") {
        if (!batchId)
          return res.status(400).json({ ok: false, error: "Missing batchId" });

        const batch = await batchStore.get(batchId);
        if (!batch) {
          return res
            .status(404)
            .json({ ok: false, error: "Batch not found (expired/deleted)" });
        }
        if (batch.type !== "news") {
          return res
            .status(404)
            .json({ ok: false, error: "Item is not socialItem" });
        }

        const r = await newsQueue.pushFromBatch(batch, { dedupe: true });
        return res.json({ ok: true, action, batchId, ...r });
      }

      return res.status(400).json({ ok: false, error: "Invalid action" });
    }
    // DELETE:
    if (req.method === "DELETE") {
      // Mode: clear all
      if (clearAll) {
        const result = await newsQueue.clear();
        return res.status(200).json({ ok: true, mode: "clearAll", ...result });
      }

      // Mode: delete one
      if (!newsId) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing newsId (or use ?clearAll=1)" });
      }

      const result = await newsQueue.del(newsId);
      return res.status(200).json({ ok: true, mode: "deleteOne", ...result });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/news-queue] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
