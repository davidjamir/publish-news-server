const { isAuthorized } = require("../helper/isAuthorized");
const { socialQueue } = require("../src/queue");
const { batchStore, socialStore } = require("../src/store");
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
    const socialId = toStr(url.searchParams.get("socialId"));
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

      const items = await socialQueue.view(limit);
      const size = await socialQueue.size();

      return res.json({ ok: true, limit, size, items });
    }

    // POST: enqueue/retry/enqueueBatch
    if (req.method === "POST") {
      // retry or enqueue single item
      if (action === "enqueue") {
        if (!socialId)
          return res.status(400).json({ ok: false, error: "Missing socialId" });

        if (force) {
          await socialQueue.del(socialId);
          await socialQueue.deleteDedupe(socialId);
        }
        const item = await socialStore.get(socialId);
        if (!item) {
          return res
            .status(400)
            .json({ ok: false, error: "Item not found (expired or deleted)" });
        }
        if (item.type !== "social") {
          return res
            .status(400)
            .json({ ok: false, error: "Item is not socialItem" });
        }

        // nếu vẫn dùng payload {id,batchId} thì dùng kiểu cũ
        const r = await socialQueue.pushOne(socialId, { dedupe: true });

        return res.json({ ok: true, action, socialId, ...r });
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
        if (batch.type !== "social") {
          return res
            .status(404)
            .json({ ok: false, error: "Item is not socialItem" });
        }

        const r = await socialQueue.pushFromBatch(batch, { dedupe: true });
        return res.json({ ok: true, action, batchId, ...r });
      }

      return res.status(400).json({ ok: false, error: "Invalid action" });
    }
    // DELETE:
    if (req.method === "DELETE") {
      // Mode: clear all
      if (clearAll) {
        const result = await socialQueue.clear();
        return res.status(200).json({ ok: true, mode: "clearAll", ...result });
      }

      // Mode: delete one
      if (!socialId) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing socialId (or use ?clearAll=1)" });
      }

      const result = await socialQueue.del(socialId);
      return res.status(200).json({ ok: true, mode: "deleteOne", ...result });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/social-queue] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
