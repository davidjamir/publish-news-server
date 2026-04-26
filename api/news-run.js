const { isAuthorized } = require("../helper/isAuthorized");
const { newsStore } = require("../src/store");
const { newsQueue } = require("../src/queue");
const { sendPost } = require("../src/mailer");
const { isoTimeZone } = require("../helper/timeZone");
const { sendNotify } = require("../src/notify");

const MAX_PER_RUN = 2;

// xử lý 1 item riêng biệt
async function processItem(doc) {
  const base = {
    newsId: doc.itemId,
  };

  try {
    const newsItem = await newsStore.get(doc.itemId);

    if (!newsItem) throw new Error("newsItem missing/expired");
    if (!newsItem.featuredImage) throw new Error("missing featured image");

    const result = await sendPost(newsItem);

    await newsStore.update(doc.itemId, {
      status: result.ok ? "sent" : "failed",
      site: result.blogDns,
      reason: result.error || null,
    });

    return {
      ...base,
      title: newsItem.title,
      link: newsItem.link,
      topic: newsItem?.topics?.[0] || "",
      targets: newsItem.targets || [],
      status: result.ok ? "success" : "failed",
      error: result.error,
      site: result.blogDns,
    };
  } catch (e) {
    const message = String(e?.message || e);

    await newsStore.update(doc.itemId, {
      status: "failed",
      reason: message,
    });

    return {
      ...base,
      status: "failed",
      error: message,
    };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const max = MAX_PER_RUN;
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    return res
      .status(400)
      .json({ ok: false, error: "max must be an integer 1..50" });
  }

  console.log("Cloudflare Cron Job Trigger Worker Run News", isoTimeZone());

  try {
    // lấy batch
    const docs = await Promise.all(
      Array.from({ length: max }, () => newsQueue.pop()),
    );

    const validDocs = docs.filter(Boolean);

    // chạy song song
    const results = await Promise.all(validDocs.map((doc) => processItem(doc)));

    // notify song song luôn
    await Promise.all(
      results
        .filter((item) => item.error)
        .map((item) =>
          sendNotify({
            type: "post-sites",
            topic: item.topic,
            title: item.title,
            status: item.status,
            targets: item.targets,
            text: String(item.error || ""),
            timeBangkok: isoTimeZone(new Date()),
            timeNewyork: isoTimeZone(new Date(), "America/New_York"),
          }),
        ),
    );

    console.log({ ok: true, processed: results.length, results });
    return res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error("[api/news-run] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
