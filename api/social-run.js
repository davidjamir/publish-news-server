const { isAuthorized } = require("../helper/isAuthorized");
const { socialStore } = require("../src/store");
const { socialQueue } = require("../src/queue");
const { isoTimeZone } = require("../helper/timeZone");
const { sendFaceBookPost } = require("../src/facebook");
const { toStr } = require("../helper/toString");
const { sendNotify } = require("../src/notify");

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
  console.log("Cloudflare Cron Job Trigger Worker Run Social", isoTimeZone());
  try {
    if (!Number.isInteger(max) || max < 1 || max > 50) {
      return res
        .status(400)
        .json({ ok: false, error: "max must be an integer 1..50" });
    }

    const results = [];
    for (let i = 0; i < max; i++) {
      const doc = await socialQueue.pop({ scheduleAt: { $lte: Date.now() } });
      if (!doc) break;

      const socialItem = await socialStore.get(doc.itemId);
      let status = "ok";
      let error = null;
      let response = {};

      try {
        if (!socialItem) throw new Error("socialItem missing/expired");
        if (!doc.itemId || !doc.page)
          throw new Error("invalid queue member (expected itemId|page)");

        response = await sendFaceBookPost(socialItem, { page: doc.page });
      } catch (e) {
        status = "failed";
        error = String(e?.message || e);
      }

      for (const item of response.results) {
        await sendNotify({
          type: "post-social",
          chatId: item.requestChatId,
          page: item.pageName,
          title: socialItem.title,
          status: item.ok,
          text: toStr(item.error),
          timeBangkok: isoTimeZone(new Date()),
          timeNewyork: isoTimeZone(new Date(), "America/New_York"),
        });
      }

      results.push({
        socialId: doc.itemId,
        status,
        ...response,
        ...(error ? { error } : {}),
      });
    }
    console.log({ ok: true, processed: results.length, ...results });
    return res.json({ ok: true, processed: results.length, ...results });
  } catch (err) {
    console.error("[api/social-run] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
