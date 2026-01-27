const getFlagValue = (flags = [], key, defaultValue = "") => {
  const k = String(key || "").trim();
  if (!k) throw new Error("key is required");

  const hit = (flags || []).find((s) => String(s || "").startsWith(k + ":"));
  if (!hit) return defaultValue;

  const v = String(hit)
    .slice((k + ":").length)
    .trim();
  return v || defaultValue;
};

module.exports = { getFlagValue };
