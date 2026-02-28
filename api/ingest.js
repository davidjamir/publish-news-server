// api/news-ingest.js
const { isAuthorized, isWrapLink } = require("../helper/isAuthorized");
const { buildHashBatchId, buildHashItemId } = require("../src/crypto");
const { getFlagValue } = require("../helper/getFlagValue");
const { toStr } = require("../helper/toString");
const { getOneBlog } = require("../database/blogs");
const { crawlQueue } = require("../src/queue");
const {
  batchStore,
  newsStore,
  socialStore,
  linkStore,
} = require("../src/store");
const {
  getType,
  getModeSocial,
  getPageName,
  getScheduleFlag,
} = require("../helper/getFlagValue");

function cutPointerPrefixAnywhere(snippet) {
  let s = toStr(snippet);
  if (!s) return "";

  s = s
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const start = s.indexOf("*]:pointer");
  if (start === -1) return s;

  const end = s.indexOf(">", start);
  if (end === -1) return s.slice(0, start).trim(); // or "" nếu muốn bỏ luôn

  return (s.slice(0, start) + " " + s.slice(end + 1))
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }
  console.log("Ingest API Publish Server News");
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const body = req.body || {};
    if (!body || typeof body !== "object") {
      return res.status(400).json({ ok: false, error: "Missing JSON body" });
    }
    const items = Array.isArray(body.items) ? body.items : [];

    if (items.length === 0 || items.length > 500) {
      return res.status(400).json({
        ok: false,
        error: "Items must not be empty and must less than 500",
      });
    }

    const payload = {
      chatId: String(body.chatId ?? ""),
      api: body.api ?? {},
      topics: Array.isArray(body.topics) ? body.topics : [],
      flags: Array.isArray(body.flags) ? body.flags : [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      targets: Array.isArray(body.targets) ? body.targets : [],
      source: body.source ?? {},
      items,
    };
    const type = getType(payload.flags);
    const page = getPageName(payload.flags);
    const modeSocial = getModeSocial(payload.flags);
    const scheduleOn = getScheduleFlag(payload.flags);

    const pages = [];
    if (modeSocial == "auto" && type === "social") {
      pages.push({
        index: pages.length,
        requestChatId: payload.chatId,
        page,
        tags: payload.tags,
        status: "pending",
        postId: "",
        error: "",
        modeSocial,
        schedule: scheduleOn,
        createdAt: new Date().toISOString(),
      });
    }

    payload.batchId = buildHashBatchId(payload);
    payload.type = type;
    payload.items = await Promise.all(
      payload.items.map(async (it) => {
        const itemId = buildHashItemId(payload.batchId, it);
        const snippet = cutPointerPrefixAnywhere(it.snippet);
        const item = {
          ...it,
          snippet,
          status: "stored",
          type: payload.type,
          targets: payload.targets,
          topics: payload.topics,
          pages,
          itemId,
          batchId: payload.batchId,
        };

        return item;
      }),
    );

    payload.index = payload.items.map((it) => it.itemId);
    await batchStore.push({ ...payload, status: "stored" });

    for (const item of payload.items) {
      if (item.type === "social") {
        if (isWrapLink()) {
          const url = new URL(item.link);
          const blog = await getOneBlog({ blogDns: url.host });
          if (!blog) continue;

          item.wrapLink =
            `https://${blog.wrapDomain}` + url.pathname + url.search;
        }

        await socialStore.push(item);
        await linkStore.push({ itemId: item.itemId, link: toStr(item.link) });
      } else if (item.type === "news") {
        await newsStore.push(item);
      } else continue;
      await crawlQueue.push(`${item.itemId}|${item.type}|0`, {
        dedupe: false,
        status: "crawl",
      });
    }

    // chỉ preview 1 phần để khỏi trả quá nặng
    const preview = items.slice(0, 2).map((it) => ({
      title: it?.title,
      link: it?.link,
    }));

    console.log({
      ok: true,
      receivedAt: new Date().toISOString(),
      chatId: payload.chatId,
      source: payload.source,
      itemsCount: items.length,
      preview,
    });
    return res.status(200).json({
      ok: true,
      receivedAt: new Date().toISOString(),
      chatId: payload.chatId,
      source: payload.source,
      itemsCount: items.length,
      preview,
    });
  } catch (err) {
    console.error("[api/ingest] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
