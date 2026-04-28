const { isAuthorized } = require("../helper/isAuthorized");
const { socialQueue } = require("../src/queue");
const { socialStore, linkStore } = require("../src/store");
const { isoTimeZone } = require("../helper/timeZone");
const { toStr } = require("../helper/toString");
const {
  getType,
  getModeSocial,
  getPageName,
  getScheduleFlag,
} = require("../helper/getFlagValue");
const {
  computeScheduleAt,
  commitScheduleForPage,
  computeViralScheduleAt,
  commitViralSchedule,
} = require("../src/scheduler");
const { getFacebookAPIByName } = require("../src/facebook");

const TTL_SCHEDULE = 1000 * 60 * 60 * 24 * 10;

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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  console.log("Cloudflare Trigger Worker Run Add Link", isoTimeZone());
  const body = req.body || {};
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Missing JSON body" });
  }

  let title = "";

  const { chatId, flags, tags, text, topics, images, videos, contentType } =
    body;
  const _flags = Array.isArray(flags) ? flags : [];
  const _tags = Array.isArray(tags) ? tags : [];
  const _topics = Array.isArray(topics) ? topics : [];
  const type = getType(_flags);
  const { page, defaultTitle } = await getPageName(_flags);
  const modeSocial = getModeSocial(_flags);
  const scheduleOn = getScheduleFlag(_flags);
  const link = extractLink(text);
  const hasMedia = (images?.length || videos?.length) > 0;
  const pipeline = hasMedia ? "viral" : "traffic";

  try {
    if (!chatId) throw new Error("Not found chatId in request!");
    if (!page) throw new Error("Missing page flag (expected page:xxx)");
    if (modeSocial !== "auto") throw new Error("modeSocial must be auto");
    if (type !== "social") throw new Error("Invalid type");

    const itemPage = await getFacebookAPIByName(page);
    if (!itemPage) throw new Error(`Page ${page} not found`);

    // -----------------------------
    // PRIORITY 1: MEDIA SYSTEM
    // -----------------------------
    if (hasMedia) {
      const hash = "media_viral_post_" + page + "_" + Date.now();
      const item = {
        snippet: text || "",
        pipeline,
        status: "stored",
        type,
        targets: [],
        topics: [],
        link: link || hash,
        guid: link || hash,
        title: text || defaultTitle || hash,
        contentType,
        images,
        videos,
        media: [
          ...(images || []).map((url) => ({ type: "image", url })),
          ...(videos || []).map((url) => ({ type: "video", url })),
        ],
        pages: [
          {
            index: 0,
            requestChatId: chatId,
            page,
            topic: _topics?.[0] || null,
            tags: _tags,
            status: "pending",
            postId: "",
            error: "",
            modeSocial,
            schedule: scheduleOn,
            createdAt: new Date().toISOString(),
          },
        ],
        publishedAt: new Date().toISOString(),
        itemId: hash,
        batchId: "batch_" + hash,
      };

      const now = Date.now();
      const scheduleAt = scheduleOn
        ? await computeViralScheduleAt({ pageId: itemPage.pageId })
        : now;

      if (scheduleAt > now + TTL_SCHEDULE) {
        throw new Error("Schedule exceeds TTL");
      }

      await socialStore.push(item);

      const r = await socialQueue.push({
        itemId: hash,
        page,
        scheduleAt,
      });

      await commitViralSchedule(itemPage.pageId, scheduleAt);

      return res.json({
        status: r.ok,
        chatId,
        page,
        topic: _topics?.[0] || null,
        title: item.snippet || item.title,
        link: "",
        timeBangkok: isoTimeZone(new Date(scheduleAt)),
        timeNewyork: isoTimeZone(new Date(scheduleAt), "America/New_York"),
      });
    }

    // -----------------------------
    // PRIORITY 2: LINK SYSTEM (OLD FLOW)
    // -----------------------------
    if (link) {
      const itemLink = await linkStore.get(link);
      if (!itemLink) throw new Error("Link not found in database!");
      const item = await socialStore.get(itemLink.itemId);
      if (!item)
        throw new Error("Item not found, may be wait a minute for crawl!");

      const now = Date.now();
      const scheduleAt = scheduleOn
        ? await computeScheduleAt({ pageId: itemPage.pageId })
        : now;
      if (scheduleAt > now + TTL_SCHEDULE) {
        throw new Error("Schedule exceeds TTL");
      }

      const pages = Array.isArray(item.pages) ? item.pages : [];

      const payload = [
        ...pages,
        {
          index: pages.length,
          requestChatId: chatId,
          page,
          topic: _topics?.[0] || null,
          tags: _tags,
          status: "pending",
          postId: "",
          error: "",
          modeSocial,
          schedule: scheduleOn,
          createdAt: new Date().toISOString(),
        },
      ];

      await socialStore.update(item.itemId, { pages: payload });
      const r = await socialQueue.push({
        itemId: itemLink.itemId,
        page,
        scheduleAt,
      });
      await commitScheduleForPage(itemPage.pageId, scheduleAt);

      title = item.title;
      return res.json({
        status: r.ok,
        ...r,
        chatId,
        page,
        topic: _topics?.[0] || null,
        title,
        link: item.link,
        timeBangkok: isoTimeZone(new Date(scheduleAt)),
        timeNewyork: isoTimeZone(new Date(scheduleAt), "America/New_York"),
      });
    }

    throw new Error("No valid content (media or link)");
  } catch (err) {
    console.error("[api/social-queue-link] error:", err);
    return res.status(500).json({
      status: false,
      title,
      text: toStr(
        err?.message ||
          "Internal Server Error or Not crawled items, waiting somne minutes!",
      ),
    });
  }
};
