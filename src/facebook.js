const { toStr } = require("../helper/toString");
const { socialStore } = require("./store");
const { isoTimeZone } = require("../helper/timeZone");
const { getOnePage, updateOnePage } = require("../database/pages");

const FB_GRAPH_BASE = `https://graph.facebook.com/v25.0`;

const commentTemplates = [
  "🔎 Full story here:",
  "📖 Read the complete version here:",
  "📰 Full coverage at:",
  "📊 In-depth breakdown here:",
  "🧠 More insights in the full article:",
  "📌 Additional details here:",
  "🔥 Full explanation here:",
  "👀 If you're curious, full story here:",
  "💡 Everything explained in detail here:",
  "📚 Background and full context:",
  "🚨 Full update here:",
  "✨ Complete write-up here:",
  "👉 Full article here:",
  "🔍 More context available at:",
  "📎 Full details here:",
  "📝 Full write-up available here:",
  "📢 Complete coverage here:",
  "🧾 Full report here:",
  "📈 Detailed article here:",
  "📉 Full breakdown here:",
  "🔥 All the details here:",
  "📍 More information here:",
  "🖊️ Full explanation in the article:",
  "📘 Full version here:",
  "📓 Complete overview here:",
  "👓 Take a closer look here:",
  "🧩 Full context explained here:",
  "🛠️ Step-by-step breakdown here:",
  "📦 Everything you need to know here:",
  "📣 Full update and details here:",
  "🧭 Explore the full story here:",
  "📜 Full background here:",
  "🔦 More insight available here:",
  "📄 Read the full piece here:",
  "📥 Full article linked here:",
  "👀 Dive deeper here:",
  "🔗 Access the full story here:",
  "🧠 Full insight here:",
  "📚 Get the complete details here:",
  "📰 Read the full coverage here:",
  "📌 Full explanation linked here:",
  "💬 Full discussion here:",
  "🧾 Complete details here:",
  "📍 Full context available here:",
];

const captionLinkCTAs = [
  "🔎 Full story here",
  "📖 Read more",
  "📰 Full coverage",
  "📊 More details",
  "👀 Take a look",
  "👉 Continue reading",
  "💡 Full breakdown",
  "📌 Full article",
  "🧠 In-depth explanation",
  "📚 Complete write-up",
  "🚨 Latest update",
  "✨ Full report",
  "📈 Detailed analysis",
  "📉 Full breakdown available",
  "🧾 Complete details",
  "📍 Full context",
  "🔍 Dive deeper",
  "📎 Full piece",
  "🗂️ All the details",
  "📣 Full coverage available",
  "Read the full story",
  "Get the full details",
  "See the full report",
  "More insights here",
  "Explore the full article",
  "Full explanation below",
  "Everything explained here",
  "Access the full story",
  "Full version available",
  "Check out the full article",
  "🔥 Don't miss the full story",
  "🚨 Breaking update here",
  "👀 You'll want to read this",
];

const captionCommentCTAs = [
  "🔗 Full story in the pinned comment.",
  "📌 Link in the first comment.",
  "👇 More details below.",
  "💬 Check the comments for the full article.",
  "📖 Complete coverage in the comments.",
  "🧾 See pinned comment for full story.",
  "📎 Link posted below.",
  "📊 Full breakdown in the comments.",
  "📰 Details in the first comment.",
  "🔍 Read more in the comments.",
  "📘 Full article in the pinned comment.",
  "💡 More info in comments.",
  "📝 Complete write-up below.",
  "📍 Full coverage in the first comment.",
  "⬇️ Link in comments.",
  "👀 See below for full details.",
  "📚 Full story shared in comments.",
  "🗂️ Check below for more.",
  "🧠 More context in the comments.",
  "✨ Full explanation in comments.",
  "📣 Story continues in the pinned comment.",
  "🚨 Extra details posted below.",
  "📄 Read the rest in comments.",
  "🧩 Full version in comments.",
  "🔦 More insights shared below.",
  "🔎 Link available in comments.",
  "🗞️ Full report posted in comments.",
  "➡️ Continue reading in the comments.",
  "📢 Full story in comments.",
  "📌 See first comment for details.",
  "Full story in the comments.",
  "Link is in the first comment.",
  "More details in the comments.",
  "See comments for the full article.",
  "Complete story below.",
  "Check the first comment.",
];

const softCTAs = [
  "What do you think about this?",
  "Thoughts on this?",
  "Your take on this?",
  "Do you agree or disagree?",
  "Is this the right move?",
  "How would you react?",
  "Would you support this?",
  "Is this surprising to you?",
  "Fair decision or not?",
  "Does this make sense?",
  "Too much or just right?",
  "Is this justified?",
  "What’s your opinion?",
  "Would you handle this differently?",
  "Do you see this as a big deal?",
  "Is this being blown out of proportion?",
  "How do you feel about this?",
  "Is this overdue?",
  "Does this change anything?",
  "Would this affect you?",
  "Is this the outcome you expected?",
  "What stands out to you the most?",
  "Do you think this will last?",
  "Is this a smart move?",
  "What would you do in this situation?",
  "Is this a step forward or backward?",
  "How should this have been handled?",
  "Agree or not?",
  "Is this something we should be talking about?",
  "Drop your thoughts below.",
  "Let us know what you think.",
  "Share your perspective.",
  "Curious to hear your opinion.",
  "Open for discussion.",
  "Let’s talk about it.",
  "We’d like to hear your view.",
  "Sound off in the comments.",
  "Join the conversation.",
  "What’s your honest take?",
  "Would you call this fair?",
  "Is this getting the reaction it deserves?",
  "Does this surprise you?",
  "What’s the bigger picture here?",
  "Is this the right direction?",
  "How would you respond to this?",
  "Are people overreacting?",
  "Should this have happened?",
  "Is this being handled properly?",
  "Would you have done the same?",
  "What’s missing from this story?",
];

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

  const main = clampText(crawlSnippet || `${title} ${snippet || ""}`, 600);
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

async function handleViralPost({ item, payload }) {
  const media = [
    ...(item.videos || []).map((v) => ["video", v]),
    ...(item.images?.length > 1
      ? [["album", item.images]]
      : item.images?.length === 1
        ? [["image", item.images[0]]]
        : []),
  ];
  let current = Math.floor(Date.now() / 1000) + 600;

  const results = [];
  let isFirst = true; // 🔥 thêm flag
  for (const [type, data] of media) {
    let scheduledTime = null;

    if (!isFirst) {
      current += 600 + (60 + Math.floor(Math.random() * 240)); // 10p + random
      scheduledTime = current;
    }

    try {
      let created = null;
      const commonParams = isFirst
        ? {
            published: true, // 🔥 đăng ngay
          }
        : {
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
      });
    }
    isFirst = false; // 🔥 nhớ set sau mỗi vòng
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
        }));

  if (pending.length === 0) {
    throw new Error(
      wantPage
        ? `sendFaceBookPost: page="${wantPage}" is not pending or not found`
        : "sendFaceBookPost: item.pages has no pending page",
    );
  }

  const results = [];
  for (const { index, requestChatId, page, tags, topic } of pending) {
    try {
      const target = await getFacebookAPIByName(page);
      if (!target) {
        throw new Error(`FACEBOOK_TARGET_NOT_FOUND: ${page}`);
      }
      const post =
        item?.pipeline === "viral"
          ? buildViralMessage(item, tags)
          : buildFaceBookPost(item, tags);
      const payload = { ...target, ...post };

      let created = null;

      if (item?.pipeline === "viral") {
        created = await handleViralPost({ item, payload, published });
      } else {
        created = await handleTrafficPost({ item, payload, published });
      }

      if (!created || created.length === 0) {
        throw new Error("NO_MEDIA_TO_POST");
      }
      const success = created.filter((r) => r.ok);
      if (!success.length) {
        const errors = created
          .filter((r) => !r.ok)
          .map((r) => r.error)
          .join(" | ");

        throw new Error(`ALL_POST_FAILED: ${errors}`);
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
      };

      results.push({
        requestChatId,
        pageName: page,
        topic,
        ok: false,
        error: msg,
      });
    }
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
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
