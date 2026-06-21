const { getManyPages, updateOnePage } = require("../database/pages");

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

const getType = (flags = [], defaultType = "default") => {
  const t = getFlagValue(flags, "type", defaultType).toLowerCase();
  return t;
};

const getModeSocial = (flags = [], defaultMode = "manual") => {
  const v = getFlagValue(flags, "modeSocial", defaultMode).toLowerCase();
  if (v !== "auto" && v !== "manual")
    throw new Error("modeSocial must be auto|manual");
  return v;
};

function getTodayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const getPageName = async (flags = [], defaultPage = "", defaultTitle = "") => {
  const pageNames = flags
    .map((f) => f.startsWith("page:") && f.slice(5))
    .filter(Boolean);

  if (!pageNames.length) return defaultPage;
  const pages = await getManyPages({
    name: { $in: pageNames },
    status: "Active"
  });

  if (!pages.length) return { page: defaultPage, defaultTitle };

  const today = getTodayStart();
  const normalized = pages.map((p) => {
    const isNewDay = !p.dailyResetAt || Number(p.dailyResetAt) !== today;

    return {
      ...p,
      dailyPostCount: isNewDay ? 0 : p.dailyPostCount || 0,
      dailyResetAt: isNewDay ? today : p.dailyResetAt,
    };
  });
  normalized.sort((a, b) => a.dailyPostCount - b.dailyPostCount);
  if (!normalized.length) return { page: defaultPage, defaultTitle };

  const min = normalized[0].dailyPostCount;
  const candidates = normalized.filter((p) => p.dailyPostCount === min);
  // random nhẹ trong nhóm min
  const picked = candidates[Math.floor(Math.random() * candidates.length)];

  await updateOnePage(
    { _id: picked._id },
    {
      dailyPostCount: (picked.dailyPostCount || 0) + 1,
      dailyResetAt: today,
    },
  );

  return {
    page: picked.name,
    defaultTitle: picked?.defaultTitle || defaultTitle,
    targetPages: pageNames,
  };
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
