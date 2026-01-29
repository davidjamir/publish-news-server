const { isAuthorized } = require("../helper/isAuthorized");
const { socialQueue } = require("../src/queue");
const { socialStore, linkStore } = require("../src/store");
const { isoTimeZone } = require("../helper/timeZone");
const { getFlagValue } = require("../helper/getFlagValue");
const {
  computeScheduleAt,
  commitScheduleForPage,
} = require("../src/scheduler");
const { getFacebookAPIByName } = require("../src/facebook");

const extractLink = (text = "") => {
  let s = String(text ?? "");
  s = s.replace(/\\r\\n|\\n|\\r/g, "\n");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, "");

  const m = s.match(/LINK\s*:\s*(https?:\/\/[^\s]+)/i);
  if (!m) return "";

  return String(m[1] || "")
    .trim()
    .replace(/[)\],.?!;]+$/g, "");
};

const getType = (flags = [], defaultType = "news") => {
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
  return getFlagValue(flags, "page", defaultPage);
};

function getScheduleFlag(flags = [], defaultSchedule = "off") {
  const v = getFlagValue(flags, "schedule", defaultSchedule).toLowerCase();
  if (["on", "1", "true", "yes", "y"].includes(v)) return true;
  if (["off", "0", "false", "no", "n"].includes(v)) return false;
  return false;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    console.log("Cloudflare Trigger Worker Run Add Link", isoTimeZone());
    const body = req.body || {};

    if (!body || typeof body !== "object") {
      return res.status(400).json({ ok: false, error: "Missing JSON body" });
    }

    const { chatId, flags, tags, text } = body;
    const _flags = Array.isArray(flags) ? flags : [];
    const _tags = Array.isArray(tags) ? tags : [];
    const type = getType(_flags);
    const page = getPageName(_flags);
    const modeSocial = getModeSocial(_flags);
    const scheduleOn = getScheduleFlag(_flags);
    const link = extractLink(text);

    if (!chatId) throw new Error("chatId is required");
    if (!link) throw new Error("LINK not found in text");
    if (type !== "social")
      throw new Error("Missing type flag (expected type:social)");
    if (!page) throw new Error("Missing page flag: page:xxx");
    if (modeSocial !== "auto") throw new Error("modeSocial must be auto");

    const itemLink = await linkStore.get(link);
    if (!itemLink) throw new Error("Link not found");
    const item = await socialStore.get(itemLink.itemId);
    if (!item) throw new Error("Item not found");
    const itemPage = await getFacebookAPIByName(page);
    if (!itemPage) throw new Error("Page item not found");

    const scheduleAt = scheduleOn
      ? await computeScheduleAt({ pageId: itemPage.pageId })
      : Date.now();
    const pages = Array.isArray(item.pages) ? item.pages : [];

    item.pages = [
      ...pages,
      {
        index: pages.length,
        requestChatId: chatId,
        page,
        tags: _tags,
        status: "pending",
        postId: "",
        error: "",
        createdAt: new Date().toISOString(),
      },
    ];

    await socialStore.push(item);
    const member = `${itemLink.itemId}|${page}`;
    const r = scheduleOn
      ? await socialQueue.scheduleOne(member, scheduleAt, { dedupe: false })
      : await socialQueue.pushOne(member, { dedupe: false });

    await commitScheduleForPage(itemPage.pageId, scheduleAt);

    return res.json({
      ok: true,
      ...r,
      chatId,
      page,
      title: item.title,
      link: item.link,
      timeBangkok: isoTimeZone(new Date(scheduleAt)),
      timeNewyork: isoTimeZone(new Date(scheduleAt), "America/New_York"),
    });
  } catch (err) {
    console.error("[api/social-queue-link] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
