// api/news-ingest.js
const { isAuthorized } = require("../helper/isAuthorized");
const { buildHashBatchId, buildHashItemId } = require("../src/crypto");
const { getFlagValue } = require("../helper/getFlagValue");
const { toStr } = require("../helper/toString");
const {
  batchStore,
  newsStore,
  socialStore,
  linkStore,
} = require("../src/store");
const { crawlQueue } = require("../src/queue");

const getType = (flags = [], defaultType = "news") => {
  const t = getFlagValue(flags, "type", defaultType).toLowerCase();
  if (t !== "news" && t !== "social")
    throw new Error("type must be news|social");
  return t;
};

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
      targets: Array.isArray(body.targets) ? body.targets : [],
      source: body.source ?? {},
      items,
      createdAt: new Date().toISOString(),
    };
    payload.batchId = buildHashBatchId(payload);
    payload.type = getType(payload.flags);
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
          pages: [],
          itemId,
          batchId: payload.batchId,
          createdAt: new Date().toISOString(),
        };

        return item;
      }),
    );

    payload.index = payload.items.map((it) => it.itemId);
    await batchStore.push({ ...payload, status: "stored" });

    for (const item of payload.items) {
      if (item.type === "social") await socialStore.push(item);
      else await newsStore.push(item);
      await linkStore.push({ itemId: item.itemId, link: item.link });
      await crawlQueue.pushOne(`${item.itemId}|${item.type}|0`, {
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
