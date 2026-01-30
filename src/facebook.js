const { redis } = require("./redis");
const { safeParse } = require("../helper/safeParse");
const { toStr } = require("../helper/toString");
const { socialStore } = require("../src/store");
const { isoTimeZone } = require("../helper/timeZone");

const FACEBOOK_TARGET_KEY = "facebook-api";
const FB_GRAPH_BASE = `https://graph.facebook.com/v24.0`;

function normPage(p) {
  return {
    source: toStr(p?.source),
    pageId: toStr(p?.pageId || p?.id),
    name: toStr(p?.name),
    token: toStr(p?.token || p?.access_token),
    updatedAt: toStr(p?.updatedAt),
  };
}

function maskToken(t) {
  const s = toStr(t);
  if (!s) return "";
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : "********";
}

function clampText(s, max = 800) {
  s = toStr(s).replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= max) return s;
  return (
    s
      .slice(0, max)
      .replace(/\s+\S*$/, "")
      .trim() + "..."
  );
}

function fixDotSpacing(text) {
  if (!text) return "";

  return String(text).replace(/\.([A-Za-z])/g, ". $1");
}

function removeLinks(text) {
  if (!text) return "";

  return String(text)
    .replace(/https?:\/\/[^\s)>\]"'}]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function getFaceBookAPIConfig() {
  const raw = await redis.get(FACEBOOK_TARGET_KEY);
  const parsed = safeParse(raw) || {};
  const pages = Array.isArray(parsed.pages) ? parsed.pages.map(normPage) : [];
  return { pages };
}

async function getFacebookAPIByName(pageName) {
  const want = toStr(pageName);
  if (!want) throw new Error("getFacebookTargetByName: pageName is required");

  const { pages } = await getFaceBookAPIConfig();
  if (!pages.length)
    throw new Error("getFacebookTargetByName: config.pages is empty");

  let found = pages.find((p) => p.name === want);

  // 2) contains match fallback
  if (!found)
    found = pages.find((p) => p.name.includes(want) || want.includes(p.name));

  if (!found) {
    throw new Error(
      `getFacebookTargetByName: page not found for name="${pageName}"`,
    );
  }

  const pageId = toStr(found.pageId);
  const token = toStr(found.token);
  if (!pageId || !token) {
    throw new Error(
      `getFacebookTargetByName: missing pageId/token for name="${
        found?.name || pageName
      }"`,
    );
  }

  return {
    pageId,
    pageToken: token,
    pageName: toStr(found?.name),
    source: toStr(found?.source),
  };
}

function buildFaceBookPost(item = {}, tags = []) {
  const title = toStr(item?.title);
  const crawlSnippet = toStr(item?.crawlSnippet);
  const snippet = toStr(item?.snippet);
  const link = toStr(item?.link);
  const imageUrl = toStr(item?.featuredImage);
  const hashtags = Array.isArray(tags)
    ? tags
        .map((t) => toStr(t).trim())
        .filter(Boolean)
        .map((t) => "#" + t.replace(/\s+/g, "")) // bỏ space
    : [];

  const main = clampText(crawlSnippet || title + " " + snippet || "", 800);
  const parts = [];
  if (main) parts.push(removeLinks(fixDotSpacing(main)));
  if (link) parts.push(`👉 Wath more in here: ${link}?fbid=1`);
  if (hashtags.length) {
    parts.push("");
    parts.push(hashtags.slice(0, 5).join(" "));
  }

  return {
    message: parts.filter(Boolean).join("\n"),
    link,
    imageUrl,
  };
}

async function viewFaceBookAPIConfig() {
  const cfg = await getFaceBookAPIConfig();
  return {
    pages: cfg.pages.map((p) => ({ ...p, maskToken: maskToken(p.token) })),
  };
}

async function saveFaceBookAPIConfig(cfg) {
  const pages = Array.isArray(cfg?.pages) ? cfg.pages.map(normPage) : [];
  await redis.set(FACEBOOK_TARGET_KEY, JSON.stringify({ pages }));
  return { ok: true, pages: pages.length };
}

async function graphFaceBookAPIPost(path, token, params) {
  const url = `${FB_GRAPH_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    const s = String(v);
    if (s === "") continue;
    body.set(k, s);
  }

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    throw new Error(`Facebook API error: ${msg}`);
  }
  return data;
}

async function sendFaceBookComment({ postId, pageToken, message }) {
  postId = toStr(postId);
  pageToken = toStr(pageToken);
  message = toStr(message);

  if (!postId) throw new Error("sendComment: postId is required");
  if (!pageToken) throw new Error("sendComment: pageToken is required");
  if (!message) throw new Error("sendComment: message is required");

  return graphFaceBookAPIPost(`/${postId}/comments`, pageToken, { message });
}

async function sendFaceBookPost(item, opts = {}) {
  const published = opts?.published !== false;

  const wantPage = toStr(opts?.page || opts?.pageName);
  const pagesArr = Array.isArray(item?.pages) ? item.pages : [];

  const pending = wantPage
    ? (() => {
        const idx = pagesArr.findIndex(
          (p) =>
            String(p?.status || "").toLowerCase() === "pending" &&
            toStr(p?.page) === wantPage,
        );
        if (idx === -1) return [];
        return [
          { index: idx, page: wantPage, tags: pagesArr[idx]?.tags || [] },
        ];
      })()
    : pagesArr
        .map((p, i) => ({ p, i }))
        .filter(
          ({ p }) =>
            String(p?.status || "").toLowerCase() === "pending" &&
            !!toStr(p?.page),
        )
        .map(({ i, p }) => ({ index: i, page: toStr(p?.page), tags: p?.tags }));

  if (pending.length === 0) {
    throw new Error(
      wantPage
        ? `sendFaceBookPost: page="${wantPage}" is not pending or not found`
        : "sendFaceBookPost: item.pages has no pending page",
    );
  }

  console.log("Break Point 2", pending);

  const results = [];
  for (const { index, page, tags } of pending) {
    try {
      const target = await getFacebookAPIByName(page);
      if (!target) {
        throw new Error(`FACEBOOK_TARGET_NOT_FOUND: ${page}`);
      }
      const post = buildFaceBookPost(item, tags);
      const payload = { ...target, ...post };

      console.log("Break Point 3", payload);

      let created = null;
      let postId = "";

      if (toStr(payload.imageUrl)) {
        created = await graphFaceBookAPIPost(
          `/${payload.pageId}/photos`,
          payload.pageToken,
          {
            url: payload.imageUrl,
            caption: payload.message,
            published,
          },
        );
        postId = toStr(created?.post_id);
      } else {
        created = await graphFaceBookAPIPost(
          `/${payload.pageId}/feed`,
          payload.pageToken,
          {
            message: payload.message,
            link: payload.link,
            published,
          },
        );
        postId = toStr(created?.id);
      }

      let commentRes = null;
      const link = toStr(payload.link);
      if (link) {
        if (!postId)
          throw new Error("sendPost: missing postId, cannot comment");
        commentRes = await sendFaceBookComment({
          postId,
          pageToken: payload.pageToken,
          message: `Read more: ${link}`,
        });
      }

      item.pages[index] = {
        ...item.pages[index],
        status: "done",
        postId,
        updatedAt: isoTimeZone(),
      };

      console.log("Break Point 4", item);

      results.push({
        ok: true,
        pageName: page,
        postId,
        post: created,
        comment: commentRes,
      });
    } catch (err) {
      const msg = String(err?.message || err);

      item.pages[index] = {
        ...item.pages[index],
        status: "failed",
        updatedAt: isoTimeZone(),
        error: msg,
      };
      console.log("Break Point 5", item);

      results.push({ pageName: page, ok: false, error: msg });
    }
  }

  const allDone = (item.pages || []).every((p) => p?.status === "done");
  item.status = allDone ? "published" : "partial";
  await socialStore.push(item);
  return { ok: true, results };
}

module.exports = {
  FACEBOOK_TARGET_KEY,
  getFacebookAPIByName,
  viewFaceBookAPIConfig,
  saveFaceBookAPIConfig,
  sendFaceBookPost,
};
