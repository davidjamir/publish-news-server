const nodemailer = require("nodemailer");
const { redis } = require("../src/redis");
const { getDayKeyAndTtlSec } = require("../helper/timeZone");
const { toStr } = require("../helper/toString");
const { getManyBlogs } = require("../database/blogs");

const BLOG_TARGET_KEY = "blog-target";

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

let _transporter = null;

function getTransporter(picked = {}) {
  if (_transporter) return _transporter;

  const user = toStr(picked.blogUser);
  let pass = toStr(picked.blogPassword);

  if (!user) throw new Error("Missing env SMTP_USER");
  if (!pass) throw new Error("Missing env SMTP_APP_PASSWORD");

  // nếu copy dạng "xxxx xxxx xxxx xxxx" thì strip hết whitespace
  pass = pass.replace(/\s+/g, "");

  _transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  return _transporter;
}

// Đang lấy theo round-daily cho dns. chưa có xây dựng theo dns riêng

async function pickBlogTargetRoundRobinDaily(targets = []) {
  if (!Array.isArray(targets)) throw new Error("Targets must be an array");

  const list = targets.filter(
    (t) => t && t.enabled !== false && toStr(t.blogDns) && toStr(t.blogEmail), // đúng field
  );

  if (!list.length) throw new Error("No enabled blog targets in 'blog-target'");
  const { yyyymmdd, ttlSec } = getDayKeyAndTtlSec(); // UTC+7 helper của mày
  const rrKey = `${BLOG_TARGET_KEY}:rr:${yyyymmdd}`;

  const counter = await redis.incr(rrKey);
  if (counter === 1) await redis.expire(rrKey, ttlSec);
  const target = list[(counter - 1) % list.length];

  return {
    blogDns: normDns(target.blogDns),
    blogEmail: toStr(target.blogEmail),
    blogUser: toStr(target.blogUser),
    blogPassword: toStr(target.blogPassword),
  };
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

  const picked = await pickBlogTargetRoundRobinDaily(
    validList.length ? validList : allTargets,
  );

  const transporter = getTransporter(picked);
  const from = toStr(picked.blogUser);
  const to = toStr(picked.blogEmail);
  if (!to) throw new Error("sendMail: missing recipient email");

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html,
  });

  return {
    ok: true,
    to,
    blogDns: picked.blogDns || null,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}

module.exports = { sendMail };
