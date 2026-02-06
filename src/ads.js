const cheerio = require("cheerio");
const { getManyAds } = require("../database/ads");

async function getAdsByDomain(domain) {
  if (!domain) return [];

  const host = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  const parts = host.split(".");
  if (parts.length < 3) return [];

  // xoá 1 tầng subdomain
  const origin = parts.slice(1).join(".");
  // TODO: xử lý sau (DB / config / switch domain)
  const ads = await getManyAds({ domain: origin, enabled: true });
  if (!Array.isArray(ads) || !ads.length) return [];

  return ads.map((ad, i) =>
    `<div class="ads-inline ads-inline-${i + 1}" data-domain="${origin}" data-ad-index="${i + 1}" style="display:block; margin:0px 0; padding:0; text-align:center; clear:both; ">
      ${ad.content}
    </div>`.trim(),
  );
}

async function injectAdsForBlog(html, domain) {
  if (!html || !domain) return html;

  const ads = await getAdsByDomain(domain);
  if (!Array.isArray(ads) || !ads.length) return html;

  const adPool = [...ads];
  const $ = cheerio.load(html, { decodeEntities: false });

  const MIN_DISTANCE = 600;
  const MAX_ADS = 3;

  const usedPositions = [];
  let inserted = 0;

  function getInsertTarget(img) {
    const $img = $(img);

    // Nếu img nằm trong figure → lấy figure
    const $figure = $img.closest("figure");
    if ($figure.length) return $figure;

    // Nếu img nằm trong p → lấy p
    const $p = $img.closest("p");
    if ($p.length) return $p;

    // Nếu img nằm trong div block → lấy div gần nhất
    const $div = $img.closest("div");
    if ($div.length) return $div;

    // fallback: chính nó
    return $img;
  }

  function getTextInsertTarget(el) {
    const $el = $(el);

    // p thường là block-level rồi
    if ($el.is("p")) return $el;

    // fallback (hiếm)
    return $el.closest("div, section, article").first();
  }

  function getCharPosUntil(idx, list) {
    let sum = 0;
    for (let i = 0; i < idx; i++) {
      const $el = $(list[i]);
      sum += $el.is("img") ? 120 : $el.text().trim().length;
    }
    return sum;
  }

  function canInsertAt(pos) {
    return usedPositions.every((p) => Math.abs(p - pos) >= MIN_DISTANCE);
  }

  function pickAdOnce() {
    if (!adPool.length) return null;
    const idx = Math.floor(Math.random() * adPool.length);
    return adPool.splice(idx, 1)[0]; // 👈 lấy & xoá
  }

  /* ========= PASS 1: sau ảnh ========= */
  const images = $("img")
    .filter((_, el) => {
      const $el = $(el);
      if ($el.closest("a, button, iframe, nav, aside").length) return false;

      if ($el.attr("aria-hidden") === "true") return false;
      return true;
    })
    .toArray();

  for (let i = 0; i < images.length && inserted < MAX_ADS; i++) {
    if (!adPool.length) break;

    const pos = getCharPosUntil(i, images);
    if (!canInsertAt(pos)) continue;

    const ad = pickAdOnce();
    if (!ad) break;

    const $target = getInsertTarget(images[i]);
    $target.after(ad);

    usedPositions.push(pos);
    inserted++;
  }

  /* ========= PASS 2: text ========= */
  if (inserted < MAX_ADS) {
    const texts = $("p, h2, h3")
      .filter((_, el) => {
        const $el = $(el);
        if ($el.is("p")) {
          return $el.text().trim().length >= 80;
        }
        return false;
      })
      .toArray();

    for (let i = 0; i < texts.length && inserted < MAX_ADS; i++) {
      if (!adPool.length) break;

      const pos = getCharPosUntil(i, texts);
      if (!canInsertAt(pos)) continue;

      const ad = pickAdOnce();
      if (!ad) break;

      const $target = getTextInsertTarget(texts[i]);
      $target.after(ad);

      usedPositions.push(pos);
      inserted++;
    }
  }

  return $.html();
}

module.exports = { injectAdsForBlog };
