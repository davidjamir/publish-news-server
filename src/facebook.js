const { toStr } = require("../helper/toString");
const { socialStore } = require("./store");
const { isoTimeZone } = require("../helper/timeZone");
const { getOnePage } = require("../database/pages");

const FB_GRAPH_BASE = `https://graph.facebook.com/v24.0`;
const MAX_NUMBER_TAGS = 5;

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

function pickRandomTags(arr = [], max = 5) {
  if (!Array.isArray(arr)) return [];

  const cloned = [...arr]; // không mutate mảng gốc

  for (let i = cloned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }

  return cloned.slice(0, max);
}

async function getFacebookAPIByName(pageName) {
  const want = toStr(pageName);
  if (!want) throw new Error("getFacebookTargetByName: pageName is required");

  let found = await getOnePage({ name: want });
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
    ? pickRandomTags(tags, MAX_NUMBER_TAGS)
        .map((t) => toStr(t).trim())
        .filter(Boolean)
        .map((t) => "#" + t.replace(/\s+/g, "")) // bỏ space
    : [];

  const main = clampText(crawlSnippet || title + " " + snippet || "", 800);
  const parts = [];
  if (main) parts.push(removeLinks(fixDotSpacing(main)));
  if (link) parts.push(`👉 Wath more in here: ${link}?fbid=1`);
  if (hashtags.length) {
    parts.push("\n");
    parts.push(hashtags.slice(0, 5).join(" "));
  }

  return {
    message: parts.filter(Boolean).join("\n"),
    link,
    imageUrl,
  };
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
          {
            index: idx,
            requestChatId: pagesArr[idx]?.requestChatId,
            page: wantPage,
            tags: pagesArr[idx]?.tags || [],
          },
        ];
      })()
    : pagesArr
        .map((p, i) => ({ p, i }))
        .filter(
          ({ p }) =>
            String(p?.status || "").toLowerCase() === "pending" &&
            !!toStr(p?.page),
        )
        .map(({ i, p }) => ({
          index: i,
          requestChatId: p?.requestChatId,
          page: toStr(p?.page),
          tags: p?.tags,
        }));

  if (pending.length === 0) {
    throw new Error(
      wantPage
        ? `sendFaceBookPost: page="${wantPage}" is not pending or not found`
        : "sendFaceBookPost: item.pages has no pending page",
    );
  }

  const results = [];
  for (const { index, requestChatId, page, tags } of pending) {
    try {
      const target = await getFacebookAPIByName(page);
      if (!target) {
        throw new Error(`FACEBOOK_TARGET_NOT_FOUND: ${page}`);
      }
      const post = buildFaceBookPost(item, tags);
      const payload = { ...target, ...post };

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

      results.push({
        ok: true,
        requestChatId,
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

      results.push({ requestChatId, pageName: page, ok: false, error: msg });
    }
  }

  const allDone = (item.pages || []).every((p) => p?.status === "done");
  item.status = allDone ? "published" : "partial";
  await socialStore.push(item);
  return { ok: true, results };
}

module.exports = {
  getFacebookAPIByName,
  sendFaceBookPost,
};
