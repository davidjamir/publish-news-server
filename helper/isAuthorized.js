function isAuthorized(req) {
  const REQUIRE_AUTH =
    String(process.env.REQUIRE_AUTH || "").toLowerCase() === "true";
  const PUBLISH_WEBHOOK_SECRET = process.env.PUBLISH_WEBHOOK_SECRET || "";

  if (!REQUIRE_AUTH) return true;
  if (!PUBLISH_WEBHOOK_SECRET) return false;

  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token && token === PUBLISH_WEBHOOK_SECRET;
}

module.exports = { isAuthorized };
