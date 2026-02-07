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

const MIN_DISTANCE = 500;
const MIN_CHARS_BEFORE_AD = 300;
const MIN_CHARS_FROM_END = 250;

async function injectAdsForBlog(html, domain) {
  if (!html || !domain) return html;

  const ads = await getAdsByDomain(domain);
  if (!Array.isArray(ads) || !ads.length) return html;

  const adPool = [...ads];
  const $ = cheerio.load(html, { decodeEntities: false });
  const totalChars = $("body").text().trim().length;
  if (totalChars < MIN_CHARS_BEFORE_AD + MIN_CHARS_FROM_END + MIN_DISTANCE)
    return html;

  const MAX_ADS = Math.max(
    0,
    Math.floor(
      (totalChars - MIN_CHARS_BEFORE_AD - MIN_CHARS_FROM_END) / MIN_DISTANCE,
    ),
  );

  const usedPositions = [];
  let inserted = 0;

  /* ================== HELPERS ================== */

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

      if ($el.is("img")) {
        sum += 120; // heuristic cho ảnh
      } else {
        sum += $el.text().trim().length;
      }
    }

    return sum;
  }

  function canInsertAt(pos) {
    if (totalChars < MIN_CHARS_BEFORE_AD + 200) return false;
    if (pos < MIN_CHARS_BEFORE_AD) return false;
    if (totalChars && pos > totalChars - MIN_CHARS_FROM_END) return false;

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

    const pos = getCharPosUntil(i, images) + 120;
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
        if ($el.closest("aside, nav, blockquote").length) return false;
        return $el.text().trim().length >= 80;
      })
      .toArray();

    for (let i = 0; i < texts.length && inserted < MAX_ADS; i++) {
      if (!adPool.length) break;

      const $el = $(texts[i]);
      const pos = getCharPosUntil(i, texts) + $el.text().trim().length;

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
function renderAdsForm() {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8"/>
    <title>Create Inline Ad</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <style>
      :root {
        --border: #e5e7eb;
        --bg: #fafafa;
        --text: #111;
        --muted: #6b7280;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
        background: var(--bg);
        color: var(--text);
      }

      .layout {
        max-width: 1100px;
        margin: 60px auto;
        padding: 0 24px;
      }

      .header {
        margin-bottom: 32px;
      }

      .header h1 {
        font-size: 24px;
        margin: 0;
        font-weight: 600;
      }

      .header p {
        margin-top: 6px;
        color: var(--muted);
        font-size: 14px;
      }

      .card {
        background: white;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 32px;
      }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }

      .field {
        display: flex;
        flex-direction: column;
      }

      .field.full {
        grid-column: 1 / -1;
      }

      label {
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 6px;
      }

      .description {
        font-size: 12px;
        color: var(--muted);
        margin-bottom: 10px;
      }

      input, textarea, select {
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 14px;
        background: white;
        transition: all 0.15s ease;
      }

      input:focus,
      textarea:focus,
      select:focus {
        outline: none;
        border-color: black;
        box-shadow: 0 0 0 1px black;
      }

      textarea {
        min-height: 160px;
        font-family: monospace;
        resize: vertical;
      }

      .footer {
        margin-top: 32px;
        display: flex;
        justify-content: flex-end;
      }

      button {
        background: black;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 10px 18px;
        font-size: 14px;
        cursor: pointer;
        transition: opacity 0.2s ease;
      }

      button:hover { opacity: 0.85; }

      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .preview {
        margin-top: 12px;
        padding: 12px;
        border: 1px dashed var(--border);
        border-radius: 8px;
        background: #fcfcfc;
        font-size: 12px;
        color: var(--muted);
        white-space: pre-wrap;
      }

      .toast {
        position: fixed;
        bottom: 30px;
        right: 30px;
        padding: 12px 18px;
        border-radius: 8px;
        font-size: 14px;
        color: white;
        background: black;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .toast.error { background: #dc2626; }

      @media (max-width: 768px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>

  <body>
    <div class="layout">
      <div class="header">
        <h1>Create Inline Ad</h1>
        <p>Configure and deploy an inline widget script to your domain.</p>
      </div>

      <form id="adForm" method="POST" action="/api/ads" class="card">

        <div class="grid">

          <div class="field">
            <label>Name</label>
            <div class="description">Internal identifier.</div>
            <input name="name" required />
          </div>

          <div class="field">
            <label>Domain</label>
            <div class="description">Where widget renders.</div>
            <input name="domain" required />
          </div>

          <div class="field">
            <label>Source</label>
            <div class="description">Ad network.</div>
            <input name="source" required />
          </div>

          <div class="field">
            <label>Priority</label>
            <div class="description">Lower = higher priority.</div>
            <input type="number" name="priority" value="10" />
          </div>

          <div class="field full">
            <label>Note</label>
            <div class="description">Optional internal note.</div>
            <input name="note" />
          </div>

          <div class="field">
            <label>Status</label>
            <div class="description">Enable or disable.</div>
            <select name="enabled">
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>

          <div class="field full">
            <label>Inline Script Content</label>
            <div class="description">Raw HTML/JS snippet.</div>
            <textarea name="content" id="content" required></textarea>
            <div class="preview" id="preview">Live preview...</div>
          </div>

          <div class="field full">
            <label>Admin Password</label>
            <div class="description">Required to authorize.</div>
            <input type="password" name="adminPassword" required />
          </div>

        </div>

        <div class="footer">
          <button type="submit" id="submitBtn">Save Ad</button>
        </div>

      </form>
    </div>

    <script>
      const form = document.getElementById("adForm");
      const textarea = document.getElementById("content");
      const preview = document.getElementById("preview");
      const button = document.getElementById("submitBtn");

      textarea.addEventListener("input", () => {
        preview.textContent = textarea.value || "Live preview...";
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();

        button.disabled = true;
        button.textContent = "Saving...";

        const formData = new FormData(form);

        const ad = {
          name: formData.get("name")?.trim(),
          domain: formData.get("domain")?.trim(),
          source: formData.get("source")?.trim(),
          note: formData.get("note")?.trim(),
          priority: Number(formData.get("priority") || 0),
          enabled: formData.get("enabled") === "true",
          content: formData.get("content")?.trim()
        };

        const payload = {
          password: formData.get("adminPassword")?.trim(),
          ads: [ad]
        };

        try {
          const res = await fetch("/api/ads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          const result = await res.json();

          if (!result.ok) throw new Error(result.error || "Failed");

          showToast("Ad saved successfully");
          form.reset();
          preview.textContent = "Live preview...";

        } catch (err) {
          showToast(err.message, true);
        }

        button.disabled = false;
        button.textContent = "Save Ad";
      });

      function showToast(message, isError = false) {
        const toast = document.createElement("div");
        toast.className = "toast" + (isError ? " error" : "");
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = "1", 10);
        setTimeout(() => {
          toast.style.opacity = "0";
          setTimeout(() => toast.remove(), 200);
        }, 6000);
      }
    </script>

  </body>
  </html>
  `;
}

module.exports = { injectAdsForBlog, renderAdsForm };
