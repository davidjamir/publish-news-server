const { isAuthorized } = require("../helper/isAuthorized");
const { isoTimeZone } = require("../helper/timeZone");
const { socialQueue } = require("../src/queue");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  // Cron chỉ cần GET là đủ
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const u = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const limit = Number(u.searchParams.get("limit") || 50);

    console.log(
      "Cloudflare Trigger Worker Run Social Scheduler",
      isoTimeZone(),
    );

    const r = await socialQueue.moveDueToQueue(limit);
    return res.json({ ok: true, now: isoTimeZone(), ...r });
  } catch (err) {
    console.error("[api/social-scheduler] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
