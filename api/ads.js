const { isAuthorized } = require("../helper/isAuthorized");
const { toStr } = require("../helper/toString");
const { getAllAds, insertManyAds } = require("../database/ads");

function normDns(s) {
  return toStr(s).toLowerCase();
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    if (req.method === "GET") {
      const ads = await getAllAds();

      return res.json({
        ok: true,
        count: ads.length,
        ads,
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const ads = body.ads;

      if (!Array.isArray(ads)) {
        return res
          .status(400)
          .json({ ok: false, error: "ads must be an array" });
      }

      const seen = new Set();
      const results = [];
      for (const t of ads) {
        const domain = normDns(t?.domain);
        const source = toStr(t?.source);
        const name = toStr(t?.name);
        if (!domain || !source || !name) continue;
        if (seen.has(`${domain}|${source}|${name}`)) continue;

        seen.add(`${domain}|${source}|${name}`);
        results.push({
          name,
          domain,
          source,
          note: t.note,
          priority: t.priority,
          count: 0,
          enabled: t.enabled,
          content: t.content,
        });
      }

      await insertManyAds(results);

      return res.json({
        ok: true,
        count: results.length,
      });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("[api/ads] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
