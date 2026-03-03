const { isAuthorized } = require("../helper/isAuthorized");
const { newsStore } = require("../src/store");
const { newsQueue } = require("../src/queue");
const { sendMail } = require("../src/mailer");
const { isoTimeZone } = require("../helper/timeZone");

const MAX_PER_RUN = 2;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  const max = MAX_PER_RUN;
  console.log("Cloudflare Cron Job Trigger Worker Run News", isoTimeZone());
  try {
    if (!Number.isInteger(max) || max < 1 || max > 50) {
      return res
        .status(400)
        .json({ ok: false, error: "max must be an integer 1..50" });
    }

    const results = [];
    for (let i = 0; i < max; i++) {
      const doc = await newsQueue.pop();
      if (!doc) break;

      let status = "ok";
      let error = null;

      try {
        const newsItem = await newsStore.get(doc.itemId);
        if (!newsItem) throw new Error("newsItem missing/expired");

        // Cần set toDns, nếu muốn gửi tới dns cụ thể, mode auto thì truyền toDns rỗng
        const r = await sendMail(newsItem);
        await newsStore.update(doc.itemId, { status: "sent", site: r.blogDns });
      } catch (e) {
        status = "failed";
        error = String(e?.message || e);
        await newsStore.update(doc.itemId, {
          status: "failed",
          reason: error,
        });
      }

      results.push({ newsId: doc.itemId, status, error });
    }
    console.log({ ok: true, processed: results.length, results });
    return res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error("[api/news-run] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
