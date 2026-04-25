const { isAuthorized } = require("../helper/isAuthorized");
const { newsStore } = require("../src/store");
const { newsQueue } = require("../src/queue");
const { sendPost } = require("../src/mailer");
const { isoTimeZone } = require("../helper/timeZone");
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

      let error = null;

      const newsItem = await newsStore.get(doc.itemId);
      if (!newsItem) throw new Error("newsItem missing/expired");
      if (!newsItem.featuredImage)
        throw new Error("newsItem missing featured image");

      let response = {
        newsId: doc.itemId,
        title: newsItem.title,
        link: newsItem.link,
        topic: newsItem?.topics[0] || "",
        targets: newsItem.targets,
      };
      try {
        const r = await sendPost(newsItem);
        await newsStore.update(doc.itemId, { status: "sent", site: r.blogDns });

        response = {
          ...response,
          status: r.ok === true ? "success" : "failed",
          error: r.error,
          site: r.blogDns,
        };
      } catch (e) {
        await newsStore.update(doc.itemId, {
          status: "failed",
          reason: error,
        });
        response = {
          ...response,
          status: "failed",
          error: String(e?.message || e),
        };
      }
      results.push(response);
    }
    for (const item of results) {
      // if (item.status !== "failed") {
      //   continue;
      // }
      await sendNotify({
        type: "post-sites",
        topic: item.topic,
        title: socialItem.title,
        status: item.status,
        text: toStr(item?.error || ""),
        timeBangkok: isoTimeZone(new Date()),
        timeNewyork: isoTimeZone(new Date(), "America/New_York"),
      });
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
