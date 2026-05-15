function extractOriginFromSubdomain(subdomain) {
  const parts = subdomain.split(".");
  if (parts.length <= 2) return subdomain;

  return parts.slice(-2).join(".");
}

module.exports = { extractOriginFromSubdomain };
