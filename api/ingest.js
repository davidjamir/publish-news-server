// api/news-ingest.js
const { isAuthorized, isShortLink } = require("../helper/isAuthorized");
const { buildHashBatchId, buildHashItemId } = require("../src/crypto");
const { toStr } = require("../helper/toString");
const { getOneBlog } = require("../database/blogs");
const { insertManyTags } = require("../database/tags");
const { crawlQueue } = require("../src/queue");
const { buildShortLink } = require("../src/shortLink");

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
      chatName: String(body.chatName ?? ""),
      chatType: String(body.chatType ?? ""),
      api: body.api ?? {},
      topics: Array.isArray(body.topics) ? body.topics : [],
      flags: Array.isArray(body.flags) ? body.flags : [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      targets: Array.isArray(body.targets) ? body.targets : [],
      source: body.source ?? {},
      items,
    };
    const type = getType(payload.flags);
    if (type !== "social" && type !== "news") {
      throw new Error("Invalid type is 'default'. Must be 'social' or 'news'");
    }

    const { page, targetPages } = await getPageName(payload.flags);
    const modeSocial = getModeSocial(payload.flags);
    const scheduleOn = getScheduleFlag(payload.flags);

    const pages = [];
    if (modeSocial == "auto" && type === "social" && page) {
      pages.push({
        index: pages.length,
        requestChatId: payload.chatId,
        chatName: payload.chatName,
        chatType: payload.chatType,
        page,
        topic: payload.topics?.[0] || null,
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
        const itemId = buildHashItemId(payload.chatId, it);
        const snippet = cutPointerPrefixAnywhere(it.snippet);
        const item = {
          ...it,
          chatId: payload.chatId,
          chatName: payload.chatName,
          chatType: payload.chatType,
          snippet,
          pipeline: "traffic",
          status: "stored",
          type: payload.type,
          targets: payload.targets,
          topics: payload.topics,
          tags: payload.tags,
          pages,
          targetPages,
          itemId,
          batchId: payload.batchId,
        };

        return item;
      }),
    );

    payload.index = payload.items.map((it) => it.itemId);

    if (payload.type === "news" && payload.targets.length <= 0) {
      throw new Error("Invalid targets list of batch. Must be has variables");
    }
    await batchStore.push({ ...payload, status: "stored" });

    if (payload.tags.length > 0) {
      await insertManyTags(payload.tags);
    }

    for (const item of payload.items) {
      if (item.type === "social") {
        if (isShortLink()) {
          const url = new URL(item.link);
          const blog = await getOneBlog({ blogDns: url.host });
          if (!blog) continue;

          item.shortLink = await buildShortLink(
            `https://${blog.wrapDomain}`,
            item.link,
          );
        }

        const { isNew } = await socialStore.push(item);
        if (!isNew) continue; // ← khoá social

        await linkStore.push({ itemId: item.itemId, link: toStr(item.link) });
      } else {
        const { isNew } = await newsStore.push(item);
        if (!isNew) continue; // ← khoá news
      }
      await crawlQueue.push({
        itemId: item.itemId,
        type: item.type,
        failCount: 0,
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
    });
  } catch (err) {
    console.log("[api/ingest] error: ", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal Server Error" });
  }
};
