// api/social.js
const { isAuthorized } = require("../helper/isAuthorized");
const { socialStore } = require("../src/store");
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
    const socialId = toStr(url.searchParams.get("socialId"));

    if (req.method === "GET") {
      // Mode 1: detail
      if (socialId) {
        const payload = await socialStore.get(socialId);
        if (!payload) {
          return res.status(404).json({
            ok: false,
            error: "Social not found (expired or deleted)",
            socialId,
          });
        }
        return res
          .status(200)
          .json({ ok: true, mode: "detail", socialId, payload });
      }

      // Mode 2: list
      const limit = rawLimit == null ? 10 : Number(String(rawLimit).trim());
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return res
          .status(400)
          .json({ ok: false, error: "limit must be a number (1..50)" });
      }

      const socials = await socialStore.view(limit);

      return res.status(200).json({
        ok: true,
        mode: "list",
        limit,
        size: socials.length,
        socials,
      });
    }

    if (req.method === "DELETE") {
      // Mode: clear all
      if (isTruthy(rawClearAll)) {
        const result = await socialStore.clear();
        return res.status(200).json({ ok: true, mode: "clearAll", ...result });
      }

      // Mode: delete one
      if (!socialId) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing socialId (or use ?clearAll=1)" });
      }

      const result = await socialStore.del(socialId);
      return res.status(200).json({ ok: true, mode: "deleteOne", ...result });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/social] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
