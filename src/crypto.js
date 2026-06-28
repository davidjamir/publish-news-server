const crypto = require("crypto");

function buildHashBatchId({ chatId, source, items }) {
  const basis = {
    chatId: String(chatId || ""),
    feedUrl: String(source?.feedUrl || ""),
    mode: String(source?.mode || ""),
    guids: (items || []).map((it) =>
      String(it?.guid || it?.link || it?.snippet || ""),
    ),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(basis))
    .digest("hex");
}

function buildHashItemId(chatId = "", item = {}) {
  const primary = String(item.link || item.guid || "").trim();
  if (!primary) throw new Error("Missing guid/link for item");
  const title = item.title || "";

  return crypto
    .createHash("sha256")
    .update(`${chatId}|${primary}|${title}`)
    .digest("hex");
}

export function buildHashShortCode(url = "", secret = "", length = 12) {
  return crypto
    .createHash("sha256")
    .update(secret + url)
    .digest("base64url")
    .slice(0, length);
}

module.exports = { buildHashBatchId, buildHashItemId, buildHashShortCode };
