const DATE_OFFSET_MIN = 7 * 60;

function getDayKeyAndTtlSec(now = new Date()) {
  const nowMs = now.getTime();

  // convert to "UTC+7 local" by adding +7h, then read date parts in UTC getters
  const localMs = nowMs + DATE_OFFSET_MIN * 60_000;
  const d = new Date(localMs);

  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1..12
  const day = d.getUTCDate(); // 1..31

  const yyyymmdd =
    String(y) + String(m).padStart(2, "0") + String(day).padStart(2, "0");

  // next midnight in UTC+7 (local) -> convert back to UTC ms
  const nextMidnightLocalUtcMs = Date.UTC(y, m - 1, day + 1, 0, 0, 0);
  const nextMidnightUtcMs = nextMidnightLocalUtcMs - DATE_OFFSET_MIN * 60_000;

  const ttlSec = Math.max(1, Math.ceil((nextMidnightUtcMs - nowMs) / 1000));

  return { yyyymmdd, ttlSec };
}

function isoTimeZone(d = new Date(), timeZone = "Asia/Bangkok") {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get(
    "minute",
  )}:${get("second")} ${timeZone}`;
}

module.exports = { isoTimeZone, getDayKeyAndTtlSec };
