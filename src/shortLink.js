const { buildHashShortCode } = require("./crypto");

async function buildShortLink(shortLinkServer, url) {
  const shortCode = buildHashShortCode(
    url,
    process.env.SHORTLINK_SERVER_SECRET,
  );

  const response = await fetch(shortLinkServer, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SHORTLINK_SERVER_SECRET}`,
    },
    body: JSON.stringify({
      shortCode,
      longUrl: url,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to create short link");
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error("Create short link failed");
  }

  return data.shortUrl;
}

module.exports = { buildShortLink };
