// /api/facebook-api.js
const { isAuthorized } = require("../helper/isAuthorized");
const { isoTimeZone } = require("../helper/timeZone");
const {
  FACEBOOK_TARGET_KEY,
  viewFaceBookAPIConfig,
  saveFaceBookAPIConfig,
} = require("../src/facebook");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (!isAuthorized(req)) {
    return j(res, { ok: false, error: "Unauthorized" }, 401);
  }
  try {
    // GET: xem config đang lưu (default: masked)
    if (req.method === "GET") {
      const cfgs = await viewFaceBookAPIConfig();

      return res.json({
        ok: true,
        key: FACEBOOK_TARGET_KEY,
        count: cfgs.length,
        ...cfgs,
      });
    }

    // POST: lưu config vào hệ thống
    if (req.method === "POST") {
      console.log(
        "Cloudflare Cron Job Trigger Worker Run Update FaceBook API",
        isoTimeZone()
      );
      const body = req.body || {};
      const pages = body.pages;

      if (!Array.isArray(pages)) {
        return res
          .status(400)
          .json({ ok: false, error: "pages must be an array" });
      }

      const r = await saveFaceBookAPIConfig({ pages });
      return res.json({
        ok: true,
        key: FACEBOOK_TARGET_KEY,
        ...r,
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
