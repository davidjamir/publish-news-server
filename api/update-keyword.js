const { isAuthorized } = require("../helper/isAuthorized");
const { getManyTags, updateOneTag } = require("../database/tags");
const { blacklistKeywordTag, whitelistKeywordTag } = require("../constants");

const MAX_PER_RUN = 20;

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

  const validKeywords = suggestions.filter((keyword) => {
    const text = keyword.toLowerCase();

    if (blacklistKeywordTag.some((b) => text.includes(b))) {
      return false;
    }

    if (
      whitelistKeywordTag.length > 0 &&
      !whitelistKeywordTag.some((w) => text.includes(w))
    ) {
      return false;
    }

    return true;
  });

  await updateOneTag(
    { name: tag.name },
    { keywords: validKeywords, lastKeywordUpdate: Date.now() },
  );

  console.log("Update keywords of tag: ", tag.name);
  return { name: tag.name };
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
        lastKeywordUpdate: { $lt: Date.now() - 1000 * 60 * 60 * 8 },
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
