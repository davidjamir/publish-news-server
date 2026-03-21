const { crawlQueue, newsQueue, socialQueue } = require("./queue");
const { newsStore, socialStore } = require("./store");
const { getFacebookAPIByName } = require("../src/facebook");
const { isoTimeZone } = require("../helper/timeZone");
const { sendNotify } = require("../src/notify");
const { toStr } = require("../helper/toString");
const {
  computeScheduleAt,
  commitScheduleForPage,
} = require("../src/scheduler");

const MIN_DELAY_MS = 5 * 60 * 1000; // 5 phút
const MAX_RETRY = 10;
const TTL_SCHEDULE = 1000 * 60 * 60 * 24 * 10;

function pickRandom(arr = []) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function loadIndexedServers(prefix) {
  const servers = [];

  for (let i = 1; i <= 10; i++) {
    const endpoint = process.env[`${prefix}_ENDPOINT_API${i}`];
    const token = process.env[`${prefix}_TOKEN_SECRET`];

    if (endpoint && token) {
      servers.push({
        endpoint: endpoint.trim(),
        token: token.trim(),
        index: i,
      });
    }
  }

  return servers;
}

const SERVER_CACHE = {};

function getServersCached(prefix) {
  if (!SERVER_CACHE[prefix]) {
    SERVER_CACHE[prefix] = loadIndexedServers(prefix);
  }
  return SERVER_CACHE[prefix];
}

function removeLinks(text) {
  if (!text) return "";

  return String(text)
    .replace(/https?:\/\/[^\s)>\]"'}]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function fetchFeatureImage(link, { endpoint, token } = {}) {
  const url = toStr(link);
  if (!url) throw new Error("link is required");

  const ep = toStr(endpoint || process.env.FEATURED_IMAGE_SERVER_ENDPOINT_API);
  if (!ep) throw new Error("FEATURED_IMAGE_SERVER_ENDPOINT_API is required");

  const tk = toStr(token || process.env.FEATURED_IMAGE_SERVER_TOKEN_SECRET);
  if (!tk) throw new Error("FEATURED_IMAGE_SERVER_TOKEN_SECRET is required");

  const r = await fetch(`${ep}?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${tk}` },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `og worker error ${r.status}`);

  return {
    featuredImage: toStr(j.image),
    crawlSnippet: toStr(removeLinks(j.snippet)),
  };
}

async function fetchContent(link, { endpoint, token } = {}) {
  const url = toStr(link);
  if (!url) throw new Error("link is required");

  const ep = toStr(endpoint || process.env.CONTENT_SERVER_ENDPOINT_API);
  if (!ep) throw new Error("CONTENT_SERVER_ENDPOINT_API is required");

  const tk = toStr(token || process.env.CONTENT_SERVER_TOKEN_SECRET);
  if (!tk) throw new Error("CONTENT_SERVER_TOKEN_SECRET is required");

  const r = await fetch(`${ep}?url=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${tk}` },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `og worker error ${r.status}`);

  return {
    crawlHtml: toStr(j.html),
    featuredImage: toStr(j.image),
    crawlSnippet: toStr(removeLinks(j.snippet)),
  };
}

async function fetchFeatureImageAuto(link) {
  const servers = [...getServersCached("FEATURED_IMAGE_SERVER")];
  const server = pickRandom(servers);

  return fetchFeatureImage(link, {
    endpoint: server?.endpoint,
    token: server?.token,
  });
}

async function fetchContentAuto(link) {
  const servers = [...getServersCached("CONTENT_SERVER")];
  const server = pickRandom(servers);

  return fetchContent(link, {
    endpoint: server?.endpoint,
    token: server?.token,
  });
}

async function runCrawl({ limit = 10, dryRun = false } = {}) {
  let processed = 0;
  let enqueued = 0;
  let items = [];

  const retryList = [];
  for (let i = 0; i < limit; i++) {
    const filter = {
      $or: [
        { type: "social" },
        {
          type: "news",
          createdAt: { $lte: new Date(Date.now() - MIN_DELAY_MS) },
        },
      ],
    };
    const doc = await crawlQueue.pop(filter);
    if (!doc) break;

    if (!doc.itemId || !doc.type) continue;
    const store = doc.type === "social" ? socialStore : newsStore;

    if (doc.failCount >= MAX_RETRY) {
      await store.update(doc.itemId, {
        crawlStatus: "error",
        failCrawl: doc.failCount,
      });
      continue;
    }

    const item = await store.get(doc.itemId);
    if (!item) continue;

    items.push(item);

    // 2️⃣ crawl
    let result = {};
    try {
      result =
        doc.type === "news"
          ? await fetchContentAuto(item.link)
          : await fetchFeatureImageAuto(item.link);
    } catch {
      console.log("Error try crawl by fectch server");
      retryList.push({
        itemId: doc.itemId,
        type: doc.type,
        failCount: doc.failCount + 1,
        reason: "Error try crawl by fectch server",
      });
      continue;
    }

    // 3️⃣ validate
    if (!dryRun && result && Object.keys(result).length) {
      await store.update(doc.itemId, {
        crawlHtml: result.crawlHtml,
        featuredImage: result.featuredImage,
        crawlSnippet: result.crawlSnippet,
        crawledAt: new Date().toISOString(),
        crawlStatus: "done",
      });
    }
    const html =
      doc.type === "news" ? toStr(result.crawlHtml || item.html) : "";
    const hasValidHtml = doc.type !== "news" || html.length >= 2000;

    if (!hasValidHtml && doc.type === "news") {
      console.log("Item not has valid html");
      retryList.push({
        itemId: doc.itemId,
        type: doc.type,
        failCount: doc.failCount + 1,
        reason: "Item not has valid html",
      });
      continue;
    }

    if (doc.type === "news" && !dryRun) {
      await newsQueue.push({ itemId: doc.itemId });
      enqueued++;
    }

    const pages = (Array.isArray(item.pages) ? item.pages : []).filter(
      (item) => item.page && item.modeSocial === "auto",
    );
    if (doc.type === "social" && pages.length > 0) {
      const response = [];

      for (const i of pages) {
        try {
          const itemPage = await getFacebookAPIByName(i.page);
          if (!itemPage) {
            response.push({
              schedule: i.schedule,
              requestChatId: i.requestChatId,
              pageName: i.page,
              title: item.title,
              ok: false,
              error: "Page not found",
            });
            continue;
          }

          const now = Date.now();
          const scheduleAt = i.schedule
            ? await computeScheduleAt({ pageId: itemPage.pageId })
            : now;

          if (scheduleAt > now + TTL_SCHEDULE) {
            throw new Error("Schedule exceeds TTL");
          }

          await socialQueue.push({
            itemId: item.itemId,
            page: i.page,
            scheduleAt,
          });

          await commitScheduleForPage(itemPage.pageId, scheduleAt);
          response.push({
            schedule: i.schedule,
            requestChatId: i.requestChatId,
            pageName: i.page,
            title: item.title,
            ok: true,
            scheduleAt,
          });
          enqueued++;
        } catch (err) {
          response.push({
            schedule: i.schedule,
            requestChatId: i.requestChatId,
            pageName: i.page,
            title: item.title,
            ok: false,
            error: err?.message || "Unknown error",
          });
        }
      }

      for (const r of response) {
        if (!r.schedule) continue;
        try {
          await sendNotify({
            type: "schedule-social",
            chatId: r.requestChatId,
            page: r.pageName,
            title: r.title,
            status: r.ok,
            text: r.error ? String(r.error) : "",
            timeBangkok: r.scheduleAt
              ? isoTimeZone(new Date(r.scheduleAt))
              : isoTimeZone(new Date()),
            timeNewyork: r.scheduleAt
              ? isoTimeZone(new Date(r.scheduleAt), "America/New_York")
              : isoTimeZone(new Date(), "America/New_York"),
          });
        } catch (notifyErr) {
          console.error("Notify failed:", notifyErr);
        }
      }
    }

    processed++;
  }

  for (const retry of retryList) {
    await crawlQueue.push(retry);
  }

  console.log({
    processed,
    retried: retryList.length,
    enqueued,
    items: items.length,
  });
  return { processed, retried: retryList.length, enqueued, items };
}

module.exports = { runCrawl };
