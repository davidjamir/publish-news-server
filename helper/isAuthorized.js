function isAuthorized(req) {
  const REQUIRE_AUTH =
    String(process.env.REQUIRE_AUTH || "").toLowerCase() === "true";
  if (!REQUIRE_AUTH) return true;

  const PUBLISH_WEBHOOK_SECRET = process.env.PUBLISH_WEBHOOK_SECRET || "";
  if (!PUBLISH_WEBHOOK_SECRET) return false;

  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token && token === PUBLISH_WEBHOOK_SECRET;
}

function isPassword(req) {
  const REQUIRE_AUTH =
    String(process.env.REQUIRE_AUTH || "").toLowerCase() === "true";
  if (!REQUIRE_AUTH) return true;

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
  if (!ADMIN_PASSWORD) return false;

  const password = req.body.password;
  return password && password === ADMIN_PASSWORD;
}

module.exports = { isAuthorized, isPassword };
