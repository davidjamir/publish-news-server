function safeParse(v) {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) v = v.toString("utf8");
  if (typeof v === "object") return v;
  if (typeof v === "string") return JSON.parse(v);
  return null;
}

module.exports = { safeParse };
