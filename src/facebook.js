const { toStr } = require("../helper/toString");
const { socialStore } = require("./store");
const { isoTimeZone } = require("../helper/timeZone");
const { getOnePage, updateOnePage } = require("../database/pages");
const { getKeywords } = require("../database/tags");
const {
  commentTemplates,
  captionLinkCTAs,
  captionCommentCTAs,
  softCTAs,
} = require("../constants");

const FB_GRAPH_BASE = `https://graph.facebook.com/v25.0`;

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

function buildTrackingLink(link) {
  if (Math.random() < 0.5) return link;
  const randomId = (len = 5) =>
    Math.random()
      .toString(36)
      .substring(2, 2 + len);

  const ts = Date.now();

  const variants = [
    "fb=1",
    "ref=fb",
    "ref=facebook",
    "source=fb",
    "source=facebook",
    "src=facebook",
    "from=facebook",
    "via=facebook",
    "traffic=facebook",
    "channel=facebook",

    "utm_source=facebook",
    "utm_source=fb",
    "utm_medium=social",
    "utm_medium=organic",
    "utm_medium=referral",
    "utm_campaign=fb_post",
    "utm_campaign=social_traffic",
    "utm_campaign=organic_reach",
    "utm_term=facebook",
    "utm_content=fb_link",

    `fbid=${randomId(6)}`,
    `post=${randomId(5)}`,
    `track=${randomId(4)}`,
    `refid=${randomId(5)}`,
    `src_id=${randomId(6)}`,
    `campaign=${randomId(5)}`,

    `t=${ts}`,
    `ts=${ts}`,
    `time=${ts}`,
    `v=${Math.floor(ts / 1000)}`,
  ];

  const pick = variants[Math.floor(Math.random() * variants.length)];
  const sep = link.includes("?") ? "&" : "?";

  return link + sep + pick;
}

function splitText(text) {
  const sentences = text.split(". ");
  if (sentences.length < 3) return [text, ""];

  const mid = Math.floor(sentences.length / 2);

  return [
    sentences.slice(0, mid).join(". ") + ".",
    sentences.slice(mid).join(". "),
  ];
}

function generateCTA(link) {
  const useDirectLink = Math.random() < 0.6;

  if (useDirectLink && link) {
    const cta =
      captionLinkCTAs[Math.floor(Math.random() * captionLinkCTAs.length)];

    const formats = [
      `${cta} ${buildTrackingLink(link)}`,
      `${cta}: ${buildTrackingLink(link)}`,
      `${cta} 👉 ${buildTrackingLink(link)}`,
      `${cta} — ${buildTrackingLink(link)}`,
    ];

    return formats[Math.floor(Math.random() * formats.length)];
  }

  const cta =
    captionCommentCTAs[Math.floor(Math.random() * captionCommentCTAs.length)];

  const emphasis = ["", " 👇", " ⬇️", " — see below"];

  return cta + emphasis[Math.floor(Math.random() * emphasis.length)];
}

function normalizeTags(tags = []) {
  return [
    ...new Set(
      tags
        .map((t) => toStr(t).trim().toLowerCase())
        .filter((t) => t.length > 0)
        .map((t) => t.replace(/\s+/g, "")),
    ),
  ];
}

function pickRandomTagsWithVariance(tags = []) {
  if (!Array.isArray(tags) || tags.length === 0) return [];
  const maxAvailable = Math.min(tags.length, 5); // mày chỉ dùng tối đa 5

  // 🔥 5% phá pattern
  if (Math.random() < 0.05) {
    const randomCount = Math.floor(Math.random() * (maxAvailable + 1));
    return pickRandomTags(tags, randomCount).map(
      (t) => "#" + toStr(t).trim().replace(/\s+/g, ""),
    );
  }

  const roll = Math.random();

  let count = 0;

  if (roll < 0.2) {
    count = 0; // 20% không dùng
  } else if (roll < 0.4) {
    count = 1; // 20% dùng 1
  } else if (roll < 0.7) {
    count = 2 + Math.floor(Math.random() * 2); // 30% dùng 2-3
  } else if (roll < 0.9) {
    count = 4; // 20% dùng 4
  } else {
    count = 5; // 10% dùng 5
  }

  if (count === 0) return [];
  count = Math.min(count, maxAvailable);

  return pickRandomTags(tags, count)
    .filter(Boolean)
    .map((t) => "#" + toStr(t).trim().replace(/\s+/g, ""));
}

function buildFaceBookPost(item = {}, tags = []) {
  const title = toStr(item?.title);
  const crawlSnippet = toStr(item?.crawlSnippet);
  const snippet = toStr(item?.snippet);
  const link = toStr(item?.wrapLink || item?.link);
  const imageUrl = toStr(item?.featuredImage);
  const cleanTags = normalizeTags(tags);
  const hashtags = pickRandomTagsWithVariance(cleanTags) || [];

  const main =
    crawlSnippet.length > 100
      ? clampText(crawlSnippet, 500)
      : clampText(`${title} ${snippet || ""}`, 500);
  const mainText = removeLinks(fixDotSpacing(main));

  const modeRoll = Math.random();
  let mode;
  if (modeRoll < 0.25) {
    mode = "noCTA"; // 10% không có CTA caption
  } else if (modeRoll < 0.5) {
    mode = "soft"; // 10% CTA mềm (không link)
  } else {
    mode = "normal"; // 80% bình thường
  }

  const positionType = Math.random();
  const parts = [];

  if (mode === "noCTA") {
    // Chỉ content
    parts.push(mainText);
  } else if (mode === "soft") {
    const soft = softCTAs[Math.floor(Math.random() * softCTAs.length)];
    parts.push(mainText);
    parts.push(soft);
  } else {
    const ctaText = generateCTA(link);
    if (positionType < 0.3) {
      // 🔥 CTA ở đầu
      parts.push(ctaText);
      parts.push(mainText);
    } else if (positionType < 0.5 && ctaText?.includes("https://")) {
      // 🔥 CTA ở giữa
      const [firstHalf, secondHalf] = splitText(mainText);
      parts.push(firstHalf);
      parts.push(ctaText);
      parts.push(secondHalf);
    } else {
      // 🔥 CTA ở cuối
      parts.push(mainText);
      parts.push(ctaText);
    }
  }

  if (hashtags.length) {
    const spacingModes = ["\n", "\n\n", "\n\n\n", " ", "\n👉 "];

    parts.push(spacingModes[Math.floor(Math.random() * spacingModes.length)]);
    parts.push(hashtags.join(" "));
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
    throw Object.assign(new Error(`Facebook API error: ${msg}`), {
      fbError: data?.error,
    });
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

function buildViralMessage(item = {}, tags = []) {
  const snippet = toStr(item?.snippet);

  const cleanTags = normalizeTags(tags);
  const hashtags = pickRandomTagsWithVariance(cleanTags);

  // content chính (ưu tiên snippet crawl cho tự nhiên)
  const main = clampText(snippet || "", 300);
  const mainText = removeLinks(fixDotSpacing(main));

  // 👉 thêm 1 chút "human tone" nhẹ (không phải CTA)
  const endings = ["", "🤔", "😶", "👀", "…", "", ""];

  const text =
    mainText + (endings[Math.floor(Math.random() * endings.length)] || "");

  const parts = [text];

  // hashtags nhẹ, không spam
  if (hashtags.length) {
    const spacingModes = ["\n", "\n\n", " "];
    parts.push(spacingModes[Math.floor(Math.random() * spacingModes.length)]);
    parts.push(hashtags.join(" "));
  }

  return {
    message: parts.filter(Boolean).join("\n"),
  };
}

async function handleViralPost({ item, payload, scheduledAt }) {
  if (!scheduledAt) {
    throw new Error("scheduledAt is required");
  }

  const media = [
    ...(item.videos || []).map((v) => ["video", v]),
    ...(item.images?.length > 1
      ? [["album", item.images]]
      : item.images?.length === 1
        ? [["image", item.images[0]]]
        : []),
  ];

  let scheduledTime = Math.floor(scheduledAt / 1000);

  const results = [];
  for (const [type, data] of media) {
    scheduledTime += 1200 + (60 + Math.floor(Math.random() * 240)); // 10p + random

    try {
      let created = null;
      const commonParams = {
        published: false,
        scheduled_publish_time: scheduledTime,
      };
      if (type === "video") {
        created = await graphFaceBookAPIPost(
          `/${payload.pageId}/videos`,
          payload.pageToken,
          {
            file_url: data,
            description: payload.message,
            ...commonParams,
          },
        );
      }

      if (type === "album") {
        const ids = [];
        const errors = [];

        for (const img of data) {
          try {
            const res = await graphFaceBookAPIPost(
              `/${payload.pageId}/photos`,
              payload.pageToken,
              { url: img, published: false },
            );

            if (res?.id) {
              ids.push({ media_fbid: res.id });
            } else {
              errors.push(`NO_ID_RETURNED: ${img}`);
            }
          } catch (e) {
            errors.push(`${img} -> ${String(e?.message || e)}`);
          }
        }
        if (!ids.length) {
          throw new Error(`ALBUM_ALL_UPLOAD_FAILED: ${errors.join(" | ")}`);
        }

        created = await graphFaceBookAPIPost(
          `/${payload.pageId}/feed`,
          payload.pageToken,
          {
            message: payload.message,
            attached_media: JSON.stringify(ids),
            ...commonParams,
          },
        );
      }

      if (type === "image") {
        created = await graphFaceBookAPIPost(
          `/${payload.pageId}/photos`,
          payload.pageToken,
          {
            url: data,
            caption: payload.message,
            ...commonParams,
          },
        );
      }

      results.push({
        type,
        ok: true,
        data,
        postId: created?.id || created?.post_id,
        created,
      });
    } catch (err) {
      results.push({
        type,
        ok: false,
        data,
        error: String(err?.message || err),
        fbError: err,
      });
    }
  }

  return results;
}

async function handleTrafficPost({ payload, published }) {
  let created = null;
  let type = "link";
  try {
    if (toStr(payload.imageUrl)) {
      type = "image";
      created = await graphFaceBookAPIPost(
        `/${payload.pageId}/photos`,
        payload.pageToken,
        {
          url: payload.imageUrl,
          caption: payload.message,
          published,
        },
      );
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
    }

    return [
      {
        type,
        ok: true,
        postId: created?.id || created?.post_id,
        created,
      },
    ];
  } catch (err) {
    console.log("Error with payload: ", payload);
    return [
      {
        type,
        ok: false,
        error: String(err?.message || err),
        fbError: err,
      },
    ];
  }
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
            topic: pagesArr[idx]?.topic,
            scheduledTime: pagesArr[idx]?.scheduledTime,
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
          topic: p?.topic,
          scheduledTime: pagesArr[idx]?.scheduledTime,
        }));

  if (pending.length === 0) {
    throw new Error(
      wantPage
        ? `sendFaceBookPost: page="${wantPage}" is not pending or not found`
        : "sendFaceBookPost: item.pages has no pending page",
    );
  }

  const results = [];
  for (const {
    index,
    requestChatId,
    page,
    tags,
    topic,
    scheduledTime,
  } of pending) {
    try {
      const target = await getFacebookAPIByName(page);
      if (!target) {
        throw new Error(`FACEBOOK_TARGET_NOT_FOUND: ${page}`);
      }

      const keywords = await getKeywords(tags);
      const post =
        item?.pipeline === "viral"
          ? buildViralMessage(item, keywords)
          : buildFaceBookPost(item, keywords);
      const payload = { ...target, ...post };

      let created = null;

      if (item?.pipeline === "viral") {
        created = await handleViralPost({
          item,
          payload,
          published,
          scheduledAt: scheduledTime,
        });
      } else {
        created = await handleTrafficPost({ item, payload, published });
      }

      if (!created || created.length === 0) {
        throw new Error("NO_MEDIA_TO_POST");
      }
      const success = created.filter((r) => r.ok);
      if (!success.length) {
        const failed = created.filter((r) => !r.ok);
        const errors = failed.map((r) => r.error).join(" | ");

        throw Object.assign(new Error(`ALL_POST_FAILED: ${errors}`), {
          fbErrors: failed,
        });
      }
      // ưu tiên post có thể comment
      const commentTarget = success.find(
        (r) =>
          r.postId &&
          (r.type === "image" || r.type === "album" || r.type === "link"),
      );

      const postId = toStr(commentTarget?.postId);

      await updateOnePage(
        { pageId: payload.pageId },
        {
          lastActivedAt: Date.now(),
          updatedAt: new Date(),
        },
      );

      let commentRes = null;
      const hasLinkInCaption = payload.message.includes("https://");
      const link = toStr(payload.link);
      const canComment = link && !hasLinkInCaption && commentTarget?.postId;

      try {
        if (canComment) {
          await sleep(1000);
          commentRes = await sendFaceBookComment({
            postId: commentTarget.postId,
            pageToken: payload.pageToken,
            message: `${commentTemplates[Math.floor(Math.random() * commentTemplates.length)]} ${link}`,
          });
        }
      } catch (e) {
        console.log("Error with by comment in Publish item: ", item?.title);
        commentRes = { ok: false, error: String(e?.message || e) };
      }

      const hasFail = created.some((r) => !r.ok);
      item.pages[index] = {
        ...item.pages[index],
        status: hasFail ? "partial" : "done",
        postIds: success.map((r) => r.postId).filter(Boolean),
        updatedAt: isoTimeZone(),
      };

      results.push({
        ok: true,
        requestChatId,
        pageName: page,
        topic,
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
        fbErrors: err?.fbErrors,
      };

      results.push({
        requestChatId,
        pageName: page,
        topic,
        ok: false,
        error: msg,
      });
    }
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
  }

  const allDone = (item.pages || []).every((p) => p?.status === "done");
  item.status = allDone ? "published" : "partial";
  await socialStore.update(item.itemId, {
    status: item.status,
    pages: item.pages,
  });
  return { ok: true, results };
}

module.exports = {
  getFacebookAPIByName,
  sendFaceBookPost,
};
