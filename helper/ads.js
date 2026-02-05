const cheerio = require("cheerio");

const ADS_BY_DOMAIN = {
  "hotzxgirl.online": [
    "<script>/* ad 1 */</script>",
    "<script>/* ad 2 */</script>",
    "<script>/* ad 3 */</script>",
  ],
  "another-site.net": ["<div class='ads ads-inline'>ANOTHER AD</div>"],
};

function getAdsByDomain(domain) {
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
  const ads = ADS_BY_DOMAIN[origin];
  if (!Array.isArray(ads) || !ads.length) return [];

  return ads.map((ad, i) =>
    `<div class="ads-inline ads-inline-${i + 1}" data-domain="${origin}" data-ad-index="${i + 1}" style="display:block; margin:0px 0; padding:0; text-align:center; clear:both; ">
      ${ad}
    </div>`.trim(),
  );
}

function injectAdsForBlog(html, domain) {
  if (!html || !domain) return html;

  const ads = getAdsByDomain(domain);
  if (!Array.isArray(ads) || !ads.length) return html;

  const adPool = [...ads];
  const $ = cheerio.load(html, { decodeEntities: false });

  const MIN_DISTANCE = 600;
  const MAX_ADS = 3;

  const usedPositions = [];
  let inserted = 0;

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
      if ($el.closest("a, figure, iframe").length) return false;
      return true;
    })
    .toArray();

  for (let i = 0; i < images.length && inserted < MAX_ADS; i++) {
    if (!adPool.length) break;

    const pos = getCharPosUntil(i, images);
    if (!canInsertAt(pos)) continue;

    const ad = pickAdOnce();
    if (!ad) break;

    $(images[i]).after(ad);
    usedPositions.push(pos);
    inserted++;
  }

  /* ========= PASS 2: text ========= */
  if (inserted < MAX_ADS) {
    const texts = $("p, h2, h3")
      .filter((_, el) => $(el).text().trim().length >= 50)
      .toArray();

    for (let i = 0; i < texts.length && inserted < MAX_ADS; i++) {
      if (!adPool.length) break;

      const pos = getCharPosUntil(i, texts);
      if (!canInsertAt(pos)) continue;

      const ad = pickAdOnce();
      if (!ad) break;

      $(texts[i]).after(ad);
      usedPositions.push(pos);
      inserted++;
    }
  }

  return $.html();
}

module.exports = { injectAdsForBlog };
