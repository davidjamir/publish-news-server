const { crawlQueue, newsQueue } = require("./queue");
const { newsStore, socialStore } = require("./store");

const MIN_DELAY_MS = 5 * 60 * 1000; // 5 phút
const MAX_RETRY = 10;
const toStr = (x) => String(x ?? "").trim();

function parseQueueId(raw) {
  const [itemId, type, countRetry = "0"] = String(raw).split("|");
  return { itemId, type, countRetry: Number(countRetry) };
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

  return { featuredImage: toStr(j.image), crawlSnippet: toStr(j.snippet) };
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
    crawlHtml: j.html,
    featuredImage: j.image,
    crawlSnippet: toStr(j.snippet),
  };
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
          ? await fetchContent(item.link)
          : await fetchFeatureImage(item.link);
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
      await newsQueue.pushOne(itemId);
      enqueued++;
    }

    processed++;
  }

  for (const retry of retryList) {
    await crawlQueue.pushOne(retry, { dedupe: false });
  }

  console.log({ processed, retried: retryList.length, enqueued });
  return { processed, retried: retryList.length, enqueued, items };
}

module.exports = { runCrawl };
