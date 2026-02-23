const nodemailer = require("nodemailer");
const { toStr } = require("../helper/toString");
const { getManyBlogs } = require("../database/blogs");
const { injectAdsForBlog } = require("../src/ads");
const {
  getQuotasToday,
  increaseQuota,
  extractOriginFromSubdomain,
} = require("../database/quotas");

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
    const subLimit = subQuota?.limit || 101; // default nếu chưa có

    const originCount = originQuota?.count || 0;
    const originLimit = originQuota?.limit || 501;

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

  return { subject: title, html };
}

/**
 * sendMail:
 * - Nếu truyền `to` => gửi thẳng
 * - Nếu không truyền `to` => auto chọn blog target theo round-robin theo ngày (UTC+7)
 */
async function sendMail(item = {}) {
  if (!item) throw new Error("sendMail: item is required");
  const { subject, html } = buildMailFromItem(item);
  if (html.length < 500)
    throw new Error("Length content html not valid for post to website");

  const requestedDns = normalizeTargetDnsList(item.targets);

  const allTargets = await getManyBlogs({ enabled: true });
  if (!allTargets.length)
    throw new Error("No targets valid for post to website");

  let validList = [];
  if (requestedDns.length) {
    validList = await getManyBlogs({
      enabled: true,
      blogDns: { $in: requestedDns },
    });
  }

  const picked = await pickWithFallback(validList, allTargets);
  if (!picked) throw new Error("sendMail: not founded target valid");

  const content = await injectAdsForBlog(html, picked.blogDns);

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

  await increaseQuota({
    type: "subdomain",
    domain: picked.blogDns,
    user: picked.blogUser,
  });

  return {
    ok: true,
    to,
    blogDns: picked.blogDns || "",
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}

module.exports = { sendMail };
