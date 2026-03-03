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

const getType = (flags = [], defaultType = "") => {
  const t = getFlagValue(flags, "type", defaultType).toLowerCase();
  if (t !== "news" && t !== "social")
    throw new Error("type must be news|social");
  return t;
};

const getModeSocial = (flags = [], defaultMode = "manual") => {
  const v = getFlagValue(flags, "modeSocial", defaultMode).toLowerCase();
  if (v !== "auto" && v !== "manual")
    throw new Error("modeSocial must be auto|manual");
  return v;
};

const getPageName = (flags = [], defaultPage = "") => {
  const pages = flags
    .map((f) => f.startsWith("page:") && f.slice(5))
    .filter(Boolean);

  return pages.length
    ? pages[Math.floor(Math.random() * pages.length)]
    : defaultPage;
};

function getScheduleFlag(flags = [], defaultSchedule = "off") {
  const v = getFlagValue(flags, "schedule", defaultSchedule).toLowerCase();
  if (["on", "1", "true", "yes", "y"].includes(v)) return true;
  if (["off", "0", "false", "no", "n"].includes(v)) return false;
  return false;
}

module.exports = {
  getFlagValue,
  getType,
  getModeSocial,
  getPageName,
  getScheduleFlag,
};
