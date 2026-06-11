const { isAuthorized } = require("../helper/isAuthorized");
const { isoTimeZone } = require("../helper/timeZone");
const { getManyTags, updateOneTag } = require("../database/tags");

const MAX_PER_RUN = 10;

const updateKeyword = async (tag) => {
  const url =
    `https://suggestqueries.google.com/complete/search` +
    `?client=firefox` +
    `&q=${encodeURIComponent(tag.name)}` +
    `&hl=en` +
    `&gl=us`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Google Suggest error: ${res.status}`);
  }

  const data = await res.json();

  const suggestions = data?.[1] || [];

  await updateOneTag(
    { name: tag.name },
    { keywords: suggestions, lastKeywordUpdate: Date.now() },
  );

  return { name: tag.name, suggestions };
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const tags = await getManyTags(
      {
        lastKeywordUpdate: { $lt: Date.now() - 1000 * 60 * 60 * 12 },
      },
      MAX_PER_RUN,
    );

    // chạy song song
    const results = await Promise.all(tags.map((tag) => updateKeyword(tag)));

    return res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error("[api/update-keyword] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
