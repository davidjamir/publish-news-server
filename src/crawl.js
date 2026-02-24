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

function parseQueueId(raw) {
  const [itemId, type, countRetry = "0"] = String(raw).split("|");
  return { itemId, type, countRetry: Number(countRetry) };
}

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
    const raw = await crawlQueue.pop();
    if (!raw) break;

    const { itemId, type, countRetry } = parseQueueId(raw);
    if (countRetry >= MAX_RETRY) continue;
    if (!itemId || !type) continue;

    const store = type === "social" ? socialStore : newsStore;
    const item = await store.get(itemId);
    if (!item) continue;

    items.push(item);
    // 1️⃣ check thời gian publish
    const createdAt = new Date(
      item.createdAt || item.publishedAt || 0,
    ).getTime();

    if (type === "news" && Date.now() - createdAt < MIN_DELAY_MS) {
      console.log("Error by not enough Time");
      retryList.push(`${itemId}|${type}|${countRetry + 1}`);
      continue;
    }

    // 2️⃣ crawl
    let result = {};
    try {
      result =
        type === "news"
          ? await fetchContentAuto(item.link)
          : await fetchFeatureImageAuto(item.link);
    } catch {
      console.log("Error try crawl by fectch server");
      retryList.push(`${itemId}|${type}|${countRetry + 1}`);
      continue;
    }

    // 3️⃣ validate
    if (!dryRun && result && Object.keys(result).length) {
      await store.update(itemId, {
        crawlHtml: result.crawlHtml,
        featuredImage: result.featuredImage,
        crawlSnippet: result.crawlSnippet,
        crawledAt: new Date().toISOString(),
      });
    }
    const html = type === "news" ? toStr(result.crawlHtml || item.html) : "";
    const hasValidHtml = type !== "news" || html.length >= 2000;

    if (!hasValidHtml && type === "news") {
      console.log("Item not has valid html");
      retryList.push(`${itemId}|${type}|${countRetry + 1}`);
      continue;
    }

    if (type === "news" && !dryRun) {
      await newsQueue.push(itemId);
      enqueued++;
    }

    const pages = (Array.isArray(item.pages) ? item.pages : []).filter(
      (item) => item.page && item.modeSocial === "auto",
    );
    if (type === "social" && pages.length > 0) {
      const response = [];

      for (const i of pages) {
        try {
          const itemPage = await getFacebookAPIByName(i.page);
          if (!itemPage) {
            response.push({
              requestChatId: i.requestChatId,
              pageName: i.page,
              title: item.title,
              ok: false,
              error: "Page not found",
            });
            continue;
          }

          const scheduleAt = i.schedule
            ? await computeScheduleAt({ pageId: itemPage.pageId })
            : Date.now();

          const member = `${item.itemId}|${i.page}`;
          if (pageItem.schedule) {
            await socialQueue.scheduleOne(member, scheduleAt, {
              dedupe: false,
            });
          } else {
            await socialQueue.push(member, { dedupe: false });
          }

          await commitScheduleForPage(itemPage.pageId, scheduleAt);
          response.push({
            requestChatId: i.requestChatId,
            pageName: i.page,
            title: item.title,
            ok: true,
          });
        } catch (err) {
          response.push({
            requestChatId: i.requestChatId,
            pageName: i.page,
            title: item.title,
            ok: false,
            error: err?.message || "Unknown error",
          });
        }
      }

      for (const r of response) {
        try {
          await sendNotify({
            chatId: r.requestChatId,
            page: r.pageName,
            title: r.title,
            status: r.ok,
            text: r.error ? String(r.error) : "",
            timeBangkok: isoTimeZone(new Date()),
            timeNewyork: isoTimeZone(new Date(), "America/New_York"),
          });
        } catch (notifyErr) {
          console.error("Notify failed:", notifyErr);
        }
      }
    }

    processed++;
  }

  for (const retry of retryList) {
    await crawlQueue.push(retry, { dedupe: false });
  }

  console.log({ processed, retried: retryList.length, enqueued });
  return { processed, retried: retryList.length, enqueued, items };
}

module.exports = { runCrawl };
