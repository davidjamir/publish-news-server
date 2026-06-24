const nodemailer = require("nodemailer");
const { toStr } = require("../helper/toString");
const { getManyBlogs } = require("../database/blogs");
const { getOneAccountAPI } = require("../database/account-api");
const { injectAdsForBlog } = require("../src/ads");
const { extractOriginFromSubdomain } = require("../helper/extractOrigin");
const { getQuotasToday, increaseQuota } = require("../database/quotas");
const { getKeywords } = require("../database/tags");

function normDns(x) {
  return toStr(x).toLowerCase().replace(/\s+/g, "");
}

function normalizeTargetDnsList(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const it of arr) {
    if (typeof it === "string") out.push(normDns(it));
    else if (it && typeof it === "object")
      out.push(normDns(it.blogDns || it.dns || it.host || it.domain));
  }
  return Array.from(new Set(out.filter(Boolean)));
}

const transporterCache = new Map();

function getTransporter(picked = {}) {
  const user = toStr(picked.blogUser);
  let pass = toStr(picked.blogPassword);

  if (!user) throw new Error("Missing env SMTP_USER");
  if (!pass) throw new Error("Missing env SMTP_APP_PASSWORD");

  // nếu copy dạng "xxxx xxxx xxxx xxxx" thì strip hết whitespace
  pass = pass.replace(/\s+/g, "");

  const cacheKey = `${user}@smtp.gmail.com`;

  if (transporterCache.has(cacheKey)) {
    return transporterCache.get(cacheKey);
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  transporterCache.set(cacheKey, transporter);
  return transporter;
}

async function filterValidTargets(targets = []) {
  const subKeys = [];
  const originKeys = [];

  for (const t of targets) {
    const user = t.blogUser;
    const sub = t.blogDns;
    const origin = extractOriginFromSubdomain(sub);

    subKeys.push(`${user}:${sub}`);
    originKeys.push(`${user}:${origin}`);
  }

  const uniqueSubKeys = [...new Set(subKeys)];
  const uniqueOriginKeys = [...new Set(originKeys)];

  const subQuotaMap = await getQuotasToday("subdomain", uniqueSubKeys);
  const originQuotaMap = await getQuotasToday("origin", uniqueOriginKeys);

  return targets.filter((target) => {
    const user = target.blogUser;
    const sub = target.blogDns;
    const origin = extractOriginFromSubdomain(sub);

    const subKey = `${user}:${sub}`;
    const originKey = `${user}:${origin}`;

    const subQuota = subQuotaMap.get(subKey);
    const originQuota = originQuotaMap.get(originKey);

    const subCount = subQuota?.count || 0;
    const subLimit = subQuota?.limit || 501; // default nếu chưa có

    const originCount = originQuota?.count || 0;
    const originLimit = originQuota?.limit || 5001;

    return subCount <= subLimit && originCount <= originLimit;
  });
}

function pickWeightedRandom(targets = []) {
  let totalWeight = 0;

  for (const t of targets) {
    totalWeight += Number(t.blogPriority) || 1;
  }

  let rand = Math.random() * totalWeight;

  for (const t of targets) {
    rand -= Number(t.blogPriority) || 1;
    if (rand <= 0) {
      return t;
    }
  }

  return targets[0]; // fallback
}

// Đang lấy theo round-daily cho dns. chưa có xây dựng theo dns riêng
async function pickBlogTargetWithQuota(targets = []) {
  if (!Array.isArray(targets)) throw new Error("Targets must be an array");

  const list = targets.filter(
    (t) => t && t.enabled !== false && toStr(t.blogDns) && toStr(t.blogEmail), // đúng field
  );
  if (!list.length) throw new Error("No enabled blog targets in 'blog-target'");

  const validTargets = await filterValidTargets(list);
  if (!validTargets.length) {
    throw new Error("All targets exceeded quota");
  }

  const target = pickWeightedRandom(validTargets);

  return {
    blogDns: normDns(target.blogDns),
    blogEmail: toStr(target.blogEmail),
    blogUser: toStr(target.blogUser),
    blogPassword: toStr(target.blogPassword),
    blogId: toStr(target.blogId),
    platform: toStr(target.platform),
  };
}

async function pickWithFallback(validList, allTargets) {
  try {
    if (validList.length) {
      return await pickBlogTargetWithQuota(validList);
    }
  } catch (_) {
    console.log("Not valid for list domains setup!");
  }

  return await pickBlogTargetWithQuota(allTargets);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildFeatureImgTag(imageUrl, alt = "") {
  const url = toStr(imageUrl);
  if (!url) return "";
  return `<p><img src="${url}" alt="${alt}" loading="lazy" decoding="async" /></p>`;
}

function prependImg(html, featureImage, title = "") {
  const s = toStr(html);
  const img = toStr(featureImage);
  if (!s || !img) return s;

  return buildFeatureImgTag(img, title) + "\n" + s;
}

function buildMailFromItem(item) {
  const title = toStr(item?.title);
  if (!title) {
    // theo yêu cầu: subject = "" rồi báo lỗi
    throw new Error("sendMail: item.title is required");
  }

  const crawlHtml = toStr(item?.crawlHtml);
  const bodyHtml = toStr(item?.html);
  const featureImage = toStr(item?.featureImage);
  const snippet = toStr(item?.snippet);
  const crawlSnippet = toStr(item?.crawlSnippet);

  const des = crawlSnippet || snippet || "";

  let html = "";
  if (crawlHtml) {
    // bản cào: giữ nguyên
    html = crawlHtml;
  } else if (bodyHtml) {
    // feed html: chèn feature image vào đầu
    html = prependImg(bodyHtml, featureImage, title);
  } else if (snippet) {
    // snippet: bọc p rồi chèn feature image
    html = prependImg(`<p>${escapeHtml(des)}</p>`, featureImage, title);
  }
  if (!html) throw new Error("sendMail: item has no html/snippet content");

  return { subject: title, html, snippet: crawlSnippet || snippet || "" };
}

function pickRandomTags(arr = [], max = 10) {
  if (!Array.isArray(arr)) return [];

  const cloned = [...arr]; // không mutate mảng gốc

  for (let i = cloned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }

  return cloned.slice(0, max);
}

/**
 * sendPost:
 * - Nếu tồn tại đủ các điều kiện API Blogger thì gửi thẳng.
 * - Nếu không hợp lệ, dùng fallback SendMail.
 */

async function sendBloggerAPI(
  { subject, content, labels, accessToken } = {},
  picked,
) {
  const res = await fetch(
    `https://www.googleapis.com/blogger/v3/blogs/${picked.blogId}/posts/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "blogger#post",
        title: subject,
        content,
        labels,
      }),
    },
  );

  let data;
  const text = await res.text();

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      text ||
      "Unknown Blogger API error";

    throw new Error(`[Blogger API ${res.status}] ${message}`);
  }

  return {
    ok: true,
    type: "api",
    postId: data.id,
    url: data.url,
    blogDns: picked.blogDns || "",
  };
}

async function sendMail({ subject, content } = {}, picked) {
  const transporter = getTransporter(picked);
  const from = toStr(picked.blogUser);
  const to = toStr(picked.blogEmail);
  if (!to) throw new Error("sendMail: missing recipient email");

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html: content,
  });

  return {
    ok: true,
    type: "mail",
    to,
    blogDns: picked.blogDns || "",
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}

async function sendAdapter(
  { featuredImage, subject, content, snippet, categories, tags } = {},
  picked,
) {
  const res = await fetch(process.env.ADAPTER_ENDPOINT_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PUBLISH_WEBHOOK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      item: {
        title: subject,
        featuredImage,
        content,
        snippet,
        categories,
        tags,
        domain: picked.blogDns,
        origin: extractOriginFromSubdomain(picked.blogDns),
      },
    }),
  });

  let data;
  const text = await res.text();

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      text ||
      "Unknown Blogger API error";

    throw new Error(`[Adapter API ${res.status}] ${message}`);
  }

  return {
    ok: true,
    type: "adapter",
    blogDns: picked.blogDns || "",
  };
}

async function sendPost(item = {}) {
  if (!item) throw new Error("sendMail: item is required");
  const { subject, html, snippet } = buildMailFromItem(item);
  if (html.length < 500)
    throw new Error("Length content html not valid for post to website");
  const labels = item.categories ?? [];
  const tags = pickRandomTags(await getKeywords(item.tags));

  const requestedDns = normalizeTargetDnsList(item.targets);

  const allTargets = await getManyBlogs({ channel: "Backup", enabled: true });

  let validList = [];
  if (requestedDns.length) {
    validList = await getManyBlogs({
      enabled: true,
      blogDns: { $in: requestedDns },
    });
  }

  const picked = await pickWithFallback(validList, allTargets);
  if (!picked) throw new Error("sendPost: not found target valid");

  const content = await injectAdsForBlog(html, picked.blogDns);
  let error1 = null;
  let error2 = null;
  let error3 = null;

  if (picked?.platform === "website") {
    try {
      const result = await sendAdapter(
        {
          featuredImage: item.featuredImage,
          subject,
          content,
          snippet,
          tags,
          categories: labels,
        },
        picked,
      );
      console.log("Adapter successful → site: ", picked.blogDns);

      await increaseQuota({
        type: "subdomain",
        domain: picked.blogDns,
        user: "adapter@gmail.com",
      });

      return result;
    } catch (err) {
      error1 = "[Adapter failed]: " + err.message;
      console.error("Adapter failed → ", err.message);
    }
  } else {
    // ===== TRY API FIRST =====
    try {
      if (!picked?.blogId)
        throw new Error("sendAPI: account blog's ID not valid");
      const account = await getOneAccountAPI({ email: picked.blogUser });
      if (!account?.accessToken)
        throw new Error("sentAPI: account's token not valid");

      const result = await sendBloggerAPI(
        { subject, content, labels, accessToken: account.accessToken },
        picked,
      );
      console.log("API successful → email: ", picked.blogUser);

      await increaseQuota({
        type: "subdomain",
        domain: picked.blogDns,
        user: picked.blogUser,
      });

      return result;
    } catch (err) {
      error2 =
        "[Blogger API failed] → fallback to mail: " +
        err.message +
        " " +
        picked.blogUser;
      console.error("[Blogger API failed] → fallback to mail: ", err.message);
    }

    // ===== FALLBACK MAIL =====
    try {
      if (!picked?.blogEmail)
        throw new Error("sendMail: target's email not valid");
      const result = await sendMail({ subject, content }, picked);

      await increaseQuota({
        type: "subdomain",
        domain: picked.blogDns,
        user: picked.blogUser,
      });

      return { ...result, error: error1 };
    } catch (err) {
      error3 = "[Mail failed]: " + err.message;
      console.error("Mail failed → ", err.message);
    }
  }

  const errorMessage = [error1, error2, error3].filter(Boolean).join(" | ");

  return {
    ok: false,
    blogDns: picked.blogDns,
    error: errorMessage || "Unknown error",
  };
}

module.exports = { sendPost };
