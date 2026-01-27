// api/crawl-run.js
const { isAuthorized } = require("../helper/isAuthorized");
const { runCrawl } = require("../src/crawl");
const { isoTimeZone } = require("../helper/timeZone");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  console.log("Cloudflare Cron Job Trigger Worker Crawl", isoTimeZone());

  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit == null ? 10 : Number(String(rawLimit).trim());
    const rawDryRun = url.searchParams.get("dryRun");
    const dryRun = rawDryRun === "1";

    const result = await runCrawl({ limit, dryRun });

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("[crawl-run api]", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Internal Server Error",
    });
  }
};
