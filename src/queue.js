const { newsStore, socialStore } = require("../src/store");

const {
  insertQueueItem,
  popOldestQueueItem,
  getQueueItems,
  deleteQueueItem,
  clearQueue,
  countQueueItems,
} = require("../database/queue");

const NEWS_COLLECTION = "news_queue";
const SOCIAL_COLLECTION = "social_queue";
const CRAWL_COLLECTION = "crawl_queue";

function makeBaseQueue(collectionName, hooks = {}) {
  const { beforePush, afterPush, beforePop, afterPop } = hooks;

  async function push(payload) {
    if (typeof beforePush === "function") {
      await beforePush(payload);
    }

    const result = insertQueueItem(collectionName, payload);

    if (typeof afterPush === "function") {
      await afterPush(result);
    }
    return result;
  }

  async function pop(filter = {}) {
    if (typeof beforePop === "function") {
      await beforePop();
    }

    const job = await popOldestQueueItem(collectionName, filter);
    if (!job) return null;

    if (typeof afterPop === "function") {
      await afterPop(job);
    }

    return job;
  }

  async function view(limit = 10) {
    return getQueueItems(collectionName, limit);
  }

  async function del(id) {
    return deleteQueueItem(collectionName, id);
  }

  async function size() {
    return countQueueItems(collectionName);
  }

  async function clear() {
    return clearQueue(collectionName);
  }

  return {
    push,
    pop,
    view,
    del,
    size,
    clear,
  };
}

function makeCrawlQueue() {
  const base = makeBaseQueue(CRAWL_COLLECTION, {
    beforePush: async (payload) => {
      const meta = {
        crawlStatus: "pending",
        queuedAt: new Date().toISOString(),
      };
      if (payload.type === "news") {
        return newsStore.update(payload.itemId, meta);
      }
      if (payload.type === "social") {
        return socialStore.update(payload.itemId, meta);
      }
    },

    afterPop: async (payload) => {
      const meta = {
        crawlStatus: "processing",
      };
      if (payload.type === "news") {
        return newsStore.update(payload.itemId, meta);
      }
      if (payload.type === "social") {
        return socialStore.update(payload.itemId, meta);
      }
    },
  });

  return base;
}

function makeNewsQueue() {
  const base = makeBaseQueue(NEWS_COLLECTION, {
    beforePush: async (payload) => {
      await newsStore.update(payload.itemId, {
        status: "queued",
        queuedAt: new Date(),
      });
    },

    afterPop: async (payload) => {
      await newsStore.update(payload.itemId, {
        status: "processing",
      });
    },
  });

  async function pushBatch(ids = []) {
    const results = [];
    for (const id of ids) {
      results.push(base.push({ itemId: id }));
    }

    return results;
  }

  return {
    ...base,
    pushBatch,
  };
}

function makeSocialQueue() {
  const base = makeBaseQueue(SOCIAL_COLLECTION, {
    beforePush: async (payload) => {
      await newsStore.update(payload.itemId, {
        status: "queued",
        queuedAt: new Date(),
      });
    },

    afterPop: async (payload) => {
      await newsStore.update(payload.itemId, {
        status: "processing",
      });
    },
  });

  async function pushBatch(ids = []) {
    const results = [];
    for (const id of ids) {
      const item = await socialStore.get(id);
      if (!item) continue;

      const pages = (item.pages || []).filter((p) => p.status === "pending");
      for (const p of pages) {
        const scheduleAt = p.schedule
          ? await computeScheduleAt({ pageId: itemPage.pageId })
          : Date.now();

        const r = await base.push({
          itemId: socialId,
          page: p.page,
          scheduleAt,
        });

        await commitScheduleForPage(itemPage.pageId, scheduleAt);
        results.push(r);
      }
    }

    return results;
  }

  return {
    ...base,
    pushBatch,
  };
}

module.exports = {
  newsQueue: makeNewsQueue(),
  socialQueue: makeSocialQueue(),
  crawlQueue: makeCrawlQueue(),
};
